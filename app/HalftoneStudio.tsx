"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Pattern = "wave" | "radial" | "linear" | "image";
type DotShape = "circle" | "square" | "hexagon";
type Lattice = "square" | "hexagonal";
type View = "studio" | "editor" | "complete";

type SourceAsset = {
  name: string;
  url: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

type ImageMetrics = {
  brightness: number;
  contrast: number;
  alphaThreshold: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

type Settings = {
  pattern: Pattern;
  dotShape: DotShape;
  lattice: Lattice;
  cellSize: number;
  dotScale: number;
  contrast: number;
  angle: number;
  widthMm: number;
  heightMm: number;
  ink: string;
  paper: string;
  invert: boolean;
  waveAmplitude: number;
  wavePeriod: number;
  waveDirection: number;
  gradientDirection: number;
  radialRatio: number;
  radialAngle: number;
  radialPeriod: number;
};

const DEFAULTS: Settings = {
  pattern: "wave",
  dotShape: "circle",
  lattice: "square",
  cellSize: 4.2,
  dotScale: 88,
  contrast: 82,
  angle: -18,
  widthMm: 180,
  heightMm: 120,
  ink: "#151513",
  paper: "#f7f3e8",
  invert: false,
  waveAmplitude: 58,
  wavePeriod: 4.5,
  waveDirection: 0,
  gradientDirection: 0,
  radialRatio: 1,
  radialAngle: 0,
  radialPeriod: 6,
};

const DEFAULT_IMAGE_METRICS: ImageMetrics = {
  brightness: 100,
  contrast: 100,
  alphaThreshold: 4,
  scale: 100,
  offsetX: 0,
  offsetY: 0,
};

const PPI = 300;
const PX_PER_MM = PPI / 25.4;
const MAX_EXPORT_PIXELS = 18_000_000;

const PATTERN_LABELS: Record<Pattern, string> = {
  wave: "流动波纹",
  radial: "径向脉冲",
  linear: "线性渐变",
  image: "上传图片",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rotatePoint(x: number, y: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
}

function imageToneAt(
  x: number,
  y: number,
  asset: SourceAsset | null,
  metrics: ImageMetrics,
) {
  if (!asset) return 0;

  const scale = metrics.scale / 100;
  const u = (x - 0.5 - metrics.offsetX / 100) / scale + 0.5;
  const v = (y - 0.5 - metrics.offsetY / 100) / scale + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

  const pixelX = clamp(Math.round(u * (asset.width - 1)), 0, asset.width - 1);
  const pixelY = clamp(Math.round(v * (asset.height - 1)), 0, asset.height - 1);
  const index = (pixelY * asset.width + pixelX) * 4;
  const alpha = asset.pixels[index + 3] / 255;
  if (alpha * 100 < metrics.alphaThreshold) return 0;

  const luminance =
    (asset.pixels[index] * 0.2126 +
      asset.pixels[index + 1] * 0.7152 +
      asset.pixels[index + 2] * 0.0722) /
    255;
  const brightened = luminance + (metrics.brightness - 100) / 100;
  const adjusted = clamp(
    (brightened - 0.5) * (metrics.contrast / 100) + 0.5,
    0,
    1,
  );
  return clamp((1 - adjusted) * alpha, 0, 1);
}

function toneAt(
  x: number,
  y: number,
  settings: Settings,
  asset: SourceAsset | null,
  imageMetrics: ImageMetrics,
) {
  const radians = (settings.angle * Math.PI) / 180;
  const dx = x - 0.5;
  const dy = y - 0.5;
  const rx = dx * Math.cos(radians) - dy * Math.sin(radians);
  const ry = dx * Math.sin(radians) + dy * Math.cos(radians);
  let value = 0;

  if (settings.pattern === "radial") {
    const radial = rotatePoint(rx, ry, settings.radialAngle);
    const ellipticalDistance = Math.hypot(
      radial.x / settings.radialRatio,
      radial.y * settings.radialRatio,
    );
    value =
      (Math.sin(ellipticalDistance * Math.PI * 2 * settings.radialPeriod) +
        1) /
      2;
  } else if (settings.pattern === "linear") {
    const gradient = rotatePoint(rx, ry, settings.gradientDirection);
    value = clamp(gradient.x + 0.5, 0, 1);
  } else if (settings.pattern === "image") {
    value = imageToneAt(x, y, asset, imageMetrics);
  } else {
    const wave = rotatePoint(rx, ry, settings.waveDirection);
    const waveAmplitude = (settings.waveAmplitude / 100) * Math.PI * 1.5;
    value =
      (Math.sin(
        wave.x * Math.PI * 2 * settings.wavePeriod +
          Math.sin(wave.y * Math.PI * settings.wavePeriod) * waveAmplitude,
      ) +
        1) /
      2;
  }

  const contrasted = clamp((value - 0.5) * (0.7 + settings.contrast / 42) + 0.5, 0, 1);
  return settings.invert ? 1 - contrasted : contrasted;
}

function forEachDot(
  width: number,
  height: number,
  settings: Settings,
  asset: SourceAsset | null,
  imageMetrics: ImageMetrics,
  callback: (x: number, y: number, radius: number) => void,
) {
  const cellPx = Math.max(4, (settings.cellSize / settings.widthMm) * width);
  const rowStep =
    settings.lattice === "hexagonal" ? cellPx * (Math.sqrt(3) / 2) : cellPx;
  const columns = Math.ceil(width / cellPx) + 1;
  const rows = Math.ceil(height / rowStep) + 1;

  for (let row = -1; row < rows; row += 1) {
    const rowOffset =
      settings.lattice === "hexagonal" && Math.abs(row % 2) === 1 ? 0.5 : 0;
    for (let column = -1; column < columns; column += 1) {
      const x = (column + 0.5 + rowOffset) * cellPx;
      const y = (row + 0.5) * rowStep;
      const tone = toneAt(
        x / width,
        y / height,
        settings,
        asset,
        imageMetrics,
      );
      const radius = Math.max(0.18, tone * cellPx * 0.49 * (settings.dotScale / 100));
      callback(x, y, radius);
    }
  }
}

function polygonPoints(
  x: number,
  y: number,
  radius: number,
  sides: number,
  rotation: number,
) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index * Math.PI * 2) / sides;
    return {
      x: x + Math.cos(angle) * radius,
      y: y + Math.sin(angle) * radius,
    };
  });
}

function traceDot(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  shape: DotShape,
) {
  if (shape === "circle") {
    context.moveTo(x + radius, y);
    context.arc(x, y, radius, 0, Math.PI * 2);
    return;
  }

  const sides = shape === "square" ? 4 : 6;
  const rotation = shape === "square" ? Math.PI / 4 : Math.PI / 6;
  const points = polygonPoints(x, y, radius, sides, rotation);
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.closePath();
}

function drawPattern(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  settings: Settings,
  asset: SourceAsset | null,
  imageMetrics: ImageMetrics,
) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = settings.paper;
  context.fillRect(0, 0, width, height);
  context.fillStyle = settings.ink;
  context.beginPath();
  forEachDot(width, height, settings, asset, imageMetrics, (x, y, radius) => {
    traceDot(context, x, y, radius, settings.dotShape);
  });
  context.fill();
}

function drawSourceField(
  canvas: HTMLCanvasElement,
  settings: Settings,
  asset: SourceAsset | null,
  imageMetrics: ImageMetrics,
) {
  const width = 720;
  const height = 480;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const imageData = context.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tone = toneAt(
        (x + 0.5) / width,
        (y + 0.5) / height,
        settings,
        asset,
        imageMetrics,
      );
      const value = Math.round((1 - tone) * 255);
      const index = (y * width + x) * 4;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function withPpi(png: Uint8Array, ppi: number) {
  const pixelsPerMeter = Math.round(ppi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  view.setUint32(8, pixelsPerMeter);
  view.setUint32(12, pixelsPerMeter);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.slice(4, 17)));

  const insertAt = 33;
  const output = new Uint8Array(png.length + chunk.length);
  output.set(png.slice(0, insertAt), 0);
  output.set(chunk, insertAt);
  output.set(png.slice(insertAt), insertAt + chunk.length);
  return output;
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function svgDot(x: number, y: number, radius: number, shape: DotShape) {
  if (shape === "circle") {
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}"/>`;
  }

  const sides = shape === "square" ? 4 : 6;
  const rotation = shape === "square" ? Math.PI / 4 : Math.PI / 6;
  const points = polygonPoints(x, y, radius, sides, rotation)
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  return `<polygon points="${points}"/>`;
}

async function loadSourceAsset(file: File): Promise<SourceAsset> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();

  const maxEdge = 900;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    URL.revokeObjectURL(url);
    throw new Error("无法读取图片像素");
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return {
    name: file.name,
    url,
    width,
    height,
    pixels: context.getImageData(0, 0, width, height).data,
  };
}

function MetricSlider({
  label,
  value,
  suffix,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <span className="field-value">
          {Number.isInteger(value) ? value : value.toFixed(1)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function HalftoneStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [view, setView] = useState<View>("studio");
  const [sourceAsset, setSourceAsset] = useState<SourceAsset | null>(null);
  const [imageMetrics, setImageMetrics] = useState<ImageMetrics>(
    DEFAULT_IMAGE_METRICS,
  );
  const [uploadError, setUploadError] = useState("");
  const [loadingImage, setLoadingImage] = useState(false);
  const [exporting, setExporting] = useState(false);

  const exportSize = useMemo(() => {
    const width = Math.round(settings.widthMm * PX_PER_MM);
    const height = Math.round(settings.heightMm * PX_PER_MM);
    const scale = Math.min(1, Math.sqrt(MAX_EXPORT_PIXELS / (width * height)));
    return {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      limited: scale < 1,
    };
  }, [settings.widthMm, settings.heightMm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const previewWidth = 1100;
    const previewHeight = Math.round(previewWidth * (settings.heightMm / settings.widthMm));
    drawPattern(
      canvas,
      previewWidth,
      previewHeight,
      settings,
      sourceAsset,
      imageMetrics,
    );
  }, [settings, sourceAsset, imageMetrics]);

  useEffect(() => {
    if (view !== "editor" || settings.pattern === "image") return;
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    drawSourceField(canvas, settings, sourceAsset, imageMetrics);
  }, [view, settings, sourceAsset, imageMetrics]);

  useEffect(() => {
    return () => {
      if (sourceAsset) URL.revokeObjectURL(sourceAsset.url);
    };
  }, [sourceAsset]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const updateImageMetric = useCallback(
    <K extends keyof ImageMetrics>(key: K, value: ImageMetrics[K]) => {
      setImageMetrics((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const resetCurrentModel = useCallback(() => {
    if (settings.pattern === "image") {
      setImageMetrics(DEFAULT_IMAGE_METRICS);
      return;
    }

    setSettings((current) => {
      if (current.pattern === "wave") {
        return {
          ...current,
          waveAmplitude: DEFAULTS.waveAmplitude,
          wavePeriod: DEFAULTS.wavePeriod,
          waveDirection: DEFAULTS.waveDirection,
        };
      }
      if (current.pattern === "linear") {
        return {
          ...current,
          gradientDirection: DEFAULTS.gradientDirection,
        };
      }
      return {
        ...current,
        radialRatio: DEFAULTS.radialRatio,
        radialAngle: DEFAULTS.radialAngle,
        radialPeriod: DEFAULTS.radialPeriod,
      };
    });
  }, [settings.pattern]);

  const uploadImage = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setUploadError("");
      setLoadingImage(true);
      try {
        const nextAsset = await loadSourceAsset(file);
        setSourceAsset(nextAsset);
        setSettings((current) => ({ ...current, pattern: "image" }));
      } catch {
        setUploadError("图片读取失败，请换用 PNG、WebP 或 JPEG。");
      } finally {
        setLoadingImage(false);
        event.target.value = "";
      }
    },
    [],
  );

  const exportPng = useCallback(async () => {
    setExporting(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    const canvas = document.createElement("canvas");
    drawPattern(
      canvas,
      exportSize.width,
      exportSize.height,
      settings,
      sourceAsset,
      imageMetrics,
    );
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) {
      const png = new Uint8Array(await blob.arrayBuffer());
      downloadBlob(
        new Blob([withPpi(png, PPI)], { type: "image/png" }),
        `halftone-${settings.widthMm}x${settings.heightMm}mm-300ppi.png`,
      );
    }
    setExporting(false);
  }, [exportSize, settings, sourceAsset, imageMetrics]);

  const exportSvg = useCallback(() => {
    const width = Math.round(settings.widthMm * 10);
    const height = Math.round(settings.heightMm * 10);
    const elements: string[] = [];
    forEachDot(
      width,
      height,
      settings,
      sourceAsset,
      imageMetrics,
      (x, y, radius) => {
        elements.push(svgDot(x, y, radius, settings.dotShape));
      },
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.widthMm}mm" height="${settings.heightMm}mm" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${escapeXml(settings.paper)}"/><g fill="${escapeXml(settings.ink)}">${elements.join("")}</g></svg>`;
    downloadBlob(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      `halftone-${settings.dotShape}-${settings.lattice}-${settings.widthMm}x${settings.heightMm}mm.svg`,
    );
  }, [settings, sourceAsset, imageMetrics]);

  if (view === "editor") {
    const isImageEditor = settings.pattern === "image";
    return (
      <main className="editor-view">
        <header className="topbar editor-topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            {PATTERN_LABELS[settings.pattern]} / EDITOR
          </div>
          <span className="editor-step">
            02 / {isImageEditor ? "ALPHA SOURCE" : "SOURCE FIELD"}
          </span>
        </header>

        <div className="editor-shell">
          <section className="editor-preview-panel" aria-labelledby="editor-title">
            <div className="editor-copy">
              <span className="eyebrow">
                {isImageEditor ? "Original alpha preview" : "Original source field"}
              </span>
              <h1 id="editor-title">
                {isImageEditor ? "先整理原图，再交给半调。" : `编辑${PATTERN_LABELS[settings.pattern]}的原始场。`}
              </h1>
              <p>
                {isImageEditor
                  ? "这里始终显示未半调化的原始 Alpha 图片。棋盘格代表透明区域，参数只改变取样方式。"
                  : "这里显示尚未转换为半调网点的连续明暗场。调整右侧参数，完成后再回到生成器查看网点效果。"}
              </p>
            </div>

            <div className="alpha-stage">
              <div className={`alpha-image-wrap${isImageEditor ? "" : " source-field-wrap"}`}>
                {isImageEditor && sourceAsset ? (
                  <>
                    {/* Object URLs from local uploads cannot use Next Image optimization. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={sourceAsset.url}
                      alt={`${sourceAsset.name} 原始 Alpha 预览`}
                      style={{
                        filter: `brightness(${imageMetrics.brightness}%) contrast(${imageMetrics.contrast}%)`,
                        transform: `translate(${imageMetrics.offsetX}%, ${imageMetrics.offsetY}%) scale(${imageMetrics.scale / 100})`,
                      }}
                    />
                  </>
                ) : (
                  <canvas
                    ref={sourceCanvasRef}
                    className="source-field-canvas"
                    aria-label={`${PATTERN_LABELS[settings.pattern]}原始明暗场`}
                  />
                )}
              </div>
              <div className="alpha-stage-meta">
                <span>
                  {isImageEditor ? sourceAsset?.name : PATTERN_LABELS[settings.pattern]}
                </span>
                <span>{isImageEditor ? "RAW ALPHA" : "NO HALFTONE DOTS"}</span>
              </div>
            </div>
          </section>

          <aside className="editor-controls" aria-label={`${PATTERN_LABELS[settings.pattern]}编辑参数`}>
            <div className="control-header">
              <h2>{isImageEditor ? "图片参数" : "模型参数"}</h2>
              <button
                className="reset"
                type="button"
                onClick={resetCurrentModel}
              >
                恢复默认
              </button>
            </div>

            <div className="editor-control-list">
              {isImageEditor && (
                <>
                  <MetricSlider label="亮度" value={imageMetrics.brightness} suffix="%" min={20} max={180} onChange={(value) => updateImageMetric("brightness", value)} />
                  <MetricSlider label="对比度" value={imageMetrics.contrast} suffix="%" min={20} max={200} onChange={(value) => updateImageMetric("contrast", value)} />
                  <MetricSlider label="Alpha 阈值" value={imageMetrics.alphaThreshold} suffix="%" min={0} max={100} onChange={(value) => updateImageMetric("alphaThreshold", value)} />
                  <MetricSlider label="图片缩放" value={imageMetrics.scale} suffix="%" min={40} max={200} onChange={(value) => updateImageMetric("scale", value)} />
                  <MetricSlider label="水平位置" value={imageMetrics.offsetX} suffix="%" min={-50} max={50} onChange={(value) => updateImageMetric("offsetX", value)} />
                  <MetricSlider label="垂直位置" value={imageMetrics.offsetY} suffix="%" min={-50} max={50} onChange={(value) => updateImageMetric("offsetY", value)} />
                </>
              )}
              {settings.pattern === "wave" && (
                <>
                  <MetricSlider label="波浪大小" value={settings.waveAmplitude} suffix="%" min={0} max={100} onChange={(value) => update("waveAmplitude", value)} />
                  <MetricSlider label="波浪周期" value={settings.wavePeriod} suffix="" min={1} max={12} step={0.5} onChange={(value) => update("wavePeriod", value)} />
                  <MetricSlider label="波浪方向" value={settings.waveDirection} suffix="°" min={-180} max={180} onChange={(value) => update("waveDirection", value)} />
                </>
              )}
              {settings.pattern === "linear" && (
                <MetricSlider label="渐变方向" value={settings.gradientDirection} suffix="°" min={-180} max={180} onChange={(value) => update("gradientDirection", value)} />
              )}
              {settings.pattern === "radial" && (
                <>
                  <MetricSlider label="椭圆形状" value={settings.radialRatio} suffix="×" min={0.4} max={2.5} step={0.1} onChange={(value) => update("radialRatio", value)} />
                  <MetricSlider label="椭圆朝向" value={settings.radialAngle} suffix="°" min={0} max={180} onChange={(value) => update("radialAngle", value)} />
                  <MetricSlider label="循环周期" value={settings.radialPeriod} suffix="" min={2} max={16} step={0.5} onChange={(value) => update("radialPeriod", value)} />
                </>
              )}
            </div>

            <div className="editor-note">
              <strong>{isImageEditor ? "透明底建议" : "原始场预览"}</strong>
              {isImageEditor
                ? "PNG 或 WebP 的透明背景能让轮廓更干净。Alpha 阈值越高，越多半透明边缘会被忽略。"
                : "白色表示较小网点，黑色表示较大网点。这里不显示重复单元形状，便于专注调整生成模型。"}
            </div>

            <div className="editor-actions">
              <button
                className="button editor-cancel"
                type="button"
                onClick={() => setView("studio")}
              >
                返回生成器
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => setView("complete")}
              >
                <span>完成编辑</span>
                <span className="button-tag">NEXT</span>
              </button>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  if (view === "complete") {
    const isImageComplete = settings.pattern === "image";
    return (
      <main className="complete-view">
        <section className="complete-card" aria-labelledby="complete-title">
          <span className="complete-index">03 / READY</span>
          <div className="complete-mark" aria-hidden="true">
            ✓
          </div>
          <h1 id="complete-title">{PATTERN_LABELS[settings.pattern]}已经准备好。</h1>
          <p>
            当前模型参数已经保存。返回生成器后，实时预览、PNG 与 SVG
            都会使用这组设置。
          </p>
          <dl className="complete-summary">
            <div>
              <dt>生成模型</dt>
              <dd>{PATTERN_LABELS[settings.pattern]}</dd>
            </div>
            <div>
              <dt>{isImageComplete ? "文件" : "重复单元"}</dt>
              <dd>{isImageComplete ? sourceAsset?.name : settings.dotShape}</dd>
            </div>
            <div>
              <dt>{isImageComplete ? "Alpha 阈值" : "重复方向"}</dt>
              <dd>{isImageComplete ? `${imageMetrics.alphaThreshold}%` : settings.lattice}</dd>
            </div>
          </dl>
          <div className="complete-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setView("editor")}
            >
              返回编辑
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setView("studio");
              }}
            >
              <span>应用并返回生成器</span>
              <span className="button-tag">APPLY</span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          HALFTONE / LAB
        </div>
        <div className="top-meta" aria-label="生成器状态">
          <span className="status-dot" aria-hidden="true" />
          <span>实时渲染 · 本地处理</span>
        </div>
      </header>

      <div className="workspace">
        <section className="preview-panel" aria-labelledby="page-title">
          <div className="preview-head">
            <div>
              <span className="eyebrow">01 / Pattern preview</span>
              <h1 id="page-title">创造你自己的半调图案</h1>
            </div>
            <div className="measure">
              {settings.widthMm} × {settings.heightMm} MM
              <br />
              {exportSize.width} × {exportSize.height} PX
            </div>
          </div>

          <div className="canvas-frame">
            <canvas
              ref={canvasRef}
              aria-label="实时半调图案预览"
              style={{ "--art-ratio": settings.widthMm / settings.heightMm } as React.CSSProperties}
            />
          </div>

          <div className="preview-foot">
            <span>每一个重复单元都是独立矢量元素。</span>
            <span>文件只在你的浏览器中生成，不会上传。</span>
          </div>
        </section>

        <aside className="control-panel" aria-label="图案控制">
          <div className="control-header">
            <h2>参数控制</h2>
            <button className="reset" type="button" onClick={() => setSettings(DEFAULTS)}>
              恢复默认
            </button>
          </div>

          <section className="control-section">
            <h3>图案结构</h3>
            <div className="control-grid">
              <label className="field">
                <span className="field-label">生成模型</span>
                <select value={settings.pattern} onChange={(event) => update("pattern", event.target.value as Pattern)}>
                  <option value="wave">流动波纹</option>
                  <option value="radial">径向脉冲</option>
                  <option value="linear">线性渐变</option>
                  <option value="image">上传自己的图片</option>
                </select>
              </label>

              {settings.pattern === "image" && (
                <div className="upload-card">
                  <div className="upload-card-copy">
                    <span className="upload-kicker">ALPHA IMAGE</span>
                    <strong>
                      {sourceAsset ? sourceAsset.name : "上传图片作为明暗来源"}
                    </strong>
                    <p>建议使用透明底 PNG 或 WebP，轮廓会更干净。</p>
                  </div>
                  <div className="upload-actions">
                    <label className="file-button" htmlFor="source-image">
                      {loadingImage
                        ? "读取中…"
                        : sourceAsset
                          ? "替换图片"
                          : "选择图片"}
                    </label>
                    <input
                      id="source-image"
                      className="file-input"
                      type="file"
                      accept="image/png,image/webp,image/jpeg"
                      onChange={uploadImage}
                      disabled={loadingImage}
                    />
                  </div>
                  {uploadError && (
                    <p className="upload-error" role="alert">
                      {uploadError}
                    </p>
                  )}
                </div>
              )}

              {settings.pattern === "wave" && (
                <div className="model-metrics">
                  <MetricSlider
                    label="波浪大小"
                    value={settings.waveAmplitude}
                    suffix="%"
                    min={0}
                    max={100}
                    onChange={(value) => update("waveAmplitude", value)}
                  />
                  <MetricSlider
                    label="波浪周期"
                    value={settings.wavePeriod}
                    suffix=""
                    min={1}
                    max={12}
                    step={0.5}
                    onChange={(value) => update("wavePeriod", value)}
                  />
                  <MetricSlider
                    label="波浪方向"
                    value={settings.waveDirection}
                    suffix="°"
                    min={-180}
                    max={180}
                    onChange={(value) => update("waveDirection", value)}
                  />
                </div>
              )}

              {settings.pattern === "linear" && (
                <div className="model-metrics">
                  <MetricSlider
                    label="渐变方向"
                    value={settings.gradientDirection}
                    suffix="°"
                    min={-180}
                    max={180}
                    onChange={(value) => update("gradientDirection", value)}
                  />
                </div>
              )}

              {settings.pattern === "radial" && (
                <div className="model-metrics">
                  <MetricSlider
                    label="椭圆形状"
                    value={settings.radialRatio}
                    suffix="×"
                    min={0.4}
                    max={2.5}
                    step={0.1}
                    onChange={(value) => update("radialRatio", value)}
                  />
                  <MetricSlider
                    label="椭圆朝向"
                    value={settings.radialAngle}
                    suffix="°"
                    min={0}
                    max={180}
                    onChange={(value) => update("radialAngle", value)}
                  />
                  <MetricSlider
                    label="循环周期"
                    value={settings.radialPeriod}
                    suffix=""
                    min={2}
                    max={16}
                    step={0.5}
                    onChange={(value) => update("radialPeriod", value)}
                  />
                </div>
              )}

              <button
                className="start-edit-button studio-edit-entry"
                type="button"
                disabled={
                  loadingImage ||
                  (settings.pattern === "image" && !sourceAsset)
                }
                onClick={() => setView("editor")}
              >
                <span>开始编辑</span>
                <span aria-hidden="true">→</span>
              </button>

              <label className="field">
                <span className="field-label">重复单元形状</span>
                <select value={settings.dotShape} onChange={(event) => update("dotShape", event.target.value as DotShape)}>
                  <option value="circle">圆形</option>
                  <option value="square">正方形</option>
                  <option value="hexagon">六边形</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">重复方向</span>
                <select value={settings.lattice} onChange={(event) => update("lattice", event.target.value as Lattice)}>
                  <option value="square">四方平移 · 0° / 90°</option>
                  <option value="hexagonal">六角平移 · 0° / 60° / 120°</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">
                  网格间距 <span className="field-value">{settings.cellSize.toFixed(1)} mm</span>
                </span>
                <input type="range" min="2" max="10" step=".1" value={settings.cellSize} onChange={(event) => update("cellSize", Number(event.target.value))} />
              </label>

              <label className="field">
                <span className="field-label">
                  网点大小 <span className="field-value">{settings.dotScale}%</span>
                </span>
                <input type="range" min="20" max="100" step="1" value={settings.dotScale} onChange={(event) => update("dotScale", Number(event.target.value))} />
              </label>

              <label className="field">
                <span className="field-label">
                  对比度 <span className="field-value">{settings.contrast}%</span>
                </span>
                <input type="range" min="20" max="100" step="1" value={settings.contrast} onChange={(event) => update("contrast", Number(event.target.value))} />
              </label>

              <label className="field">
                <span className="field-label">
                  网屏角度 <span className="field-value">{settings.angle}°</span>
                </span>
                <input type="range" min="-45" max="45" step="1" value={settings.angle} onChange={(event) => update("angle", Number(event.target.value))} />
              </label>

              <div className="toggle-row">
                反转明暗
                <button className="switch" type="button" role="switch" aria-checked={settings.invert} aria-label="反转明暗" onClick={() => update("invert", !settings.invert)} />
              </div>
            </div>
          </section>

          <section className="control-section">
            <h3>成品规格</h3>
            <div className="control-grid">
              <div className="dimension-row">
                <label className="small-label">
                  宽度 / mm
                  <input type="number" min="30" max="400" value={settings.widthMm} onChange={(event) => update("widthMm", clamp(Number(event.target.value), 30, 400))} />
                </label>
                <label className="small-label">
                  高度 / mm
                  <input type="number" min="30" max="400" value={settings.heightMm} onChange={(event) => update("heightMm", clamp(Number(event.target.value), 30, 400))} />
                </label>
              </div>
              <div className="color-row">
                <label className="small-label">
                  油墨
                  <input className="color-control" type="color" value={settings.ink} onChange={(event) => update("ink", event.target.value)} />
                </label>
                <label className="small-label">
                  纸张
                  <input className="color-control" type="color" value={settings.paper} onChange={(event) => update("paper", event.target.value)} />
                </label>
              </div>
            </div>
          </section>

          <div className="export-section">
            <p className="export-note">
              PNG 按物理尺寸换算并写入 300 ppi。超大画幅会自动限制总像素，避免浏览器内存溢出。
            </p>
            <button className="button button-primary" type="button" onClick={exportPng} disabled={exporting}>
              <span>{exporting ? "正在生成…" : "导出 PNG"}</span>
              <span className="button-tag">300 PPI</span>
            </button>
            <button className="button button-secondary" type="button" onClick={exportSvg}>
              <span>导出 SVG</span>
              <span className="button-tag">VECTOR</span>
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
