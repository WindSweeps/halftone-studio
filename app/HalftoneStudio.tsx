"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Pattern = "wave" | "radial" | "linear";
type DotShape = "circle" | "square" | "hexagon";
type Lattice = "square" | "hexagonal";

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
};

const PPI = 300;
const PX_PER_MM = PPI / 25.4;
const MAX_EXPORT_PIXELS = 18_000_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toneAt(x: number, y: number, settings: Settings) {
  const radians = (settings.angle * Math.PI) / 180;
  const dx = x - 0.5;
  const dy = y - 0.5;
  const rx = dx * Math.cos(radians) - dy * Math.sin(radians);
  const ry = dx * Math.sin(radians) + dy * Math.cos(radians);
  let value = 0;

  if (settings.pattern === "radial") {
    value = (Math.sin(Math.hypot(rx, ry) * Math.PI * 12) + 1) / 2;
  } else if (settings.pattern === "linear") {
    value = clamp(rx + 0.5, 0, 1);
  } else {
    value = (Math.sin(rx * Math.PI * 9 + Math.sin(ry * Math.PI * 5) * 2.2) + 1) / 2;
  }

  const contrasted = clamp((value - 0.5) * (0.7 + settings.contrast / 42) + 0.5, 0, 1);
  return settings.invert ? 1 - contrasted : contrasted;
}

function forEachDot(
  width: number,
  height: number,
  settings: Settings,
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
      const tone = toneAt(x / width, y / height, settings);
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
) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = settings.paper;
  context.fillRect(0, 0, width, height);
  context.fillStyle = settings.ink;
  context.beginPath();
  forEachDot(width, height, settings, (x, y, radius) => {
    traceDot(context, x, y, radius, settings.dotShape);
  });
  context.fill();
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

export default function HalftoneStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
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
    drawPattern(canvas, previewWidth, previewHeight, settings);
  }, [settings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const exportPng = useCallback(async () => {
    setExporting(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    const canvas = document.createElement("canvas");
    drawPattern(canvas, exportSize.width, exportSize.height, settings);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) {
      const png = new Uint8Array(await blob.arrayBuffer());
      downloadBlob(
        new Blob([withPpi(png, PPI)], { type: "image/png" }),
        `halftone-${settings.widthMm}x${settings.heightMm}mm-300ppi.png`,
      );
    }
    setExporting(false);
  }, [exportSize, settings]);

  const exportSvg = useCallback(() => {
    const width = Math.round(settings.widthMm * 10);
    const height = Math.round(settings.heightMm * 10);
    const elements: string[] = [];
    forEachDot(width, height, settings, (x, y, radius) => {
      elements.push(svgDot(x, y, radius, settings.dotShape));
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.widthMm}mm" height="${settings.heightMm}mm" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${escapeXml(settings.paper)}"/><g fill="${escapeXml(settings.ink)}">${elements.join("")}</g></svg>`;
    downloadBlob(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      `halftone-${settings.dotShape}-${settings.lattice}-${settings.widthMm}x${settings.heightMm}mm.svg`,
    );
  }, [settings]);

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
                </select>
              </label>

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
                <button className="switch" type="button" role="switch" aria-checked={settings.invert} aria-pressed={settings.invert} aria-label="反转明暗" onClick={() => update("invert", !settings.invert)} />
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
