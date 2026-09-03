"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

type Pattern = "wave" | "radial" | "linear" | "image";
type DotShape = "circle" | "square" | "hexagon";
type Lattice = "square" | "hexagonal";
type Material = "smooth" | "mottled" | "fractal";
type FractalType = "basic" | "turbulentSmooth" | "turbulentSharp" | "max" | "strings";
type NoiseInterpolation = "block" | "linear" | "soft";
type NoiseOverflow = "clip" | "softClamp" | "wrapBack";
type View = "studio" | "editor" | "complete";
type ChannelId = "C" | "M" | "Y" | "K";

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
  latticeAngle: number;
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
  gaussianDeltaRatio: number;
  periodicMin: number;
  periodicMax: number;
};

type ChannelState = {
  id: ChannelId;
  name: string;
  active: boolean;
  strength: number;
  offsetX: number;
  offsetY: number;
  material: Material;
  materialAmount: number;
  fractalType: FractalType;
  fractalNoiseType: NoiseInterpolation;
  fractalOverflow: NoiseOverflow;
  fractalInvert: boolean;
  fractalScale: number;
  fractalAspect: number;
  fractalComplexity: number;
  fractalLayerWeight: number;
  fractalSubScaling: number;
  fractalSubRotation: number;
  fractalSubOffsetX: number;
  fractalSubOffsetY: number;
  fractalContrast: number;
  fractalBrightness: number;
  fractalAngle: number;
  fractalEvolution: number;
  fractalOffsetX: number;
  fractalOffsetY: number;
  fractalRandomSeed: number;
  fractalCycleEvolution: boolean;
  fractalCycle: number;
  settings: Settings;
};

const DEFAULTS: Settings = {
  pattern: "linear",
  dotShape: "circle",
  lattice: "square",
  cellSize: 4.2,
  dotScale: 88,
  contrast: 82,
  latticeAngle: 0,
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
  gaussianDeltaRatio: 0.14,
  periodicMin: 0,
  periodicMax: 100,
};

const DEFAULT_IMAGE_METRICS: ImageMetrics = {
  brightness: 100,
  contrast: 100,
  alphaThreshold: 4,
  scale: 100,
  offsetX: 0,
  offsetY: 0,
};

const CHANNEL_PRESETS: Array<{
  id: ChannelId;
  name: string;
  color: string;
  active: boolean;
}> = [
  { id: "C", name: "Cyan", color: "#00aee8", active: true },
  { id: "M", name: "Magenta", color: "#ec168c", active: true },
  { id: "Y", name: "Yellow", color: "#ffd400", active: false },
  { id: "K", name: "Key", color: "#191919", active: false },
];

function createDefaultChannels(): ChannelState[] {
  return CHANNEL_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    active: preset.active,
    strength: 100,
    offsetX: 0,
    offsetY: 0,
    material: "smooth",
    materialAmount: 45,
    fractalType: "turbulentSmooth",
    fractalNoiseType: "soft",
    fractalOverflow: "clip",
    fractalInvert: false,
    fractalScale: 100,
    fractalAspect: 100,
    fractalComplexity: 4,
    fractalLayerWeight: 50,
    fractalSubScaling: 50,
    fractalSubRotation: 0,
    fractalSubOffsetX: 0,
    fractalSubOffsetY: 0,
    fractalContrast: 125,
    fractalBrightness: 0,
    fractalAngle: 0,
    fractalEvolution: 0,
    fractalOffsetX: 0,
    fractalOffsetY: 0,
    fractalRandomSeed: 0,
    fractalCycleEvolution: false,
    fractalCycle: 2,
    settings: { ...DEFAULTS, ink: preset.color },
  }));
}

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

function periodicGaussian(
  phase: number,
  deltaRatio: number,
  minimum: number,
  maximum: number,
) {
  const wrapped = ((phase % 1) + 1) % 1;
  const delta = Math.max(0.01, deltaRatio);
  let gaussian = 0;
  let peak = 0;

  for (let periodOffset = -4; periodOffset <= 4; periodOffset += 1) {
    const distance = wrapped - 0.5 + periodOffset;
    gaussian += Math.exp(-0.5 * (distance / delta) ** 2);
    peak += Math.exp(-0.5 * (periodOffset / delta) ** 2);
  }

  const normalized = clamp(gaussian / peak, 0, 1);
  const low = minimum / 100;
  const high = maximum / 100;
  return low + normalized * (high - low);
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
  const dx = x - 0.5;
  const dy = y - 0.5;
  let value = 0;

  if (settings.pattern === "radial") {
    const radial = rotatePoint(dx, dy, settings.radialAngle);
    const ellipticalDistance = Math.hypot(
      radial.x / settings.radialRatio,
      radial.y * settings.radialRatio,
    );
    value = periodicGaussian(
      ellipticalDistance * settings.radialPeriod,
      settings.gaussianDeltaRatio,
      settings.periodicMin,
      settings.periodicMax,
    );
  } else if (settings.pattern === "linear") {
    const gradient = rotatePoint(dx, dy, settings.gradientDirection);
    value = clamp(gradient.x + 0.5, 0, 1);
  } else if (settings.pattern === "image") {
    value = imageToneAt(x, y, asset, imageMetrics);
  } else {
    const wave = rotatePoint(dx, dy, settings.waveDirection);
    const waveAmplitude = (settings.waveAmplitude / 100) * 0.75;
    const phase =
      wave.x * settings.wavePeriod +
      Math.sin(wave.y * Math.PI * settings.wavePeriod) * waveAmplitude;
    value = periodicGaussian(
      phase,
      settings.gaussianDeltaRatio,
      settings.periodicMin,
      settings.periodicMax,
    );
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
  callback: (x: number, y: number, radius: number, textureSeed: number) => void,
  gridOffsetX = 0,
  gridOffsetY = 0,
  material: Material = "smooth",
  materialSeed = 0,
) {
  const cellPx = Math.max(4, (settings.cellSize / settings.widthMm) * width);
  const rowStep =
    settings.lattice === "hexagonal" ? cellPx * (Math.sqrt(3) / 2) : cellPx;
  const span = Math.hypot(width, height) + cellPx * 4;
  const columns = Math.ceil(span / cellPx);
  const rows = Math.ceil(span / rowStep);
  const centerX = width / 2;
  const centerY = height / 2;

  for (let row = -rows; row <= rows; row += 1) {
    const rowOffset =
      settings.lattice === "hexagonal" && Math.abs(row % 2) === 1 ? 0.5 : 0;
    for (let column = -columns; column <= columns; column += 1) {
      const latticePoint = rotatePoint(
        (column + rowOffset + gridOffsetX / 100) * cellPx,
        (row + gridOffsetY / 100) * rowStep,
        settings.latticeAngle,
      );
      const x = centerX + latticePoint.x;
      const y = centerY + latticePoint.y;
      if (
        x < -cellPx ||
        x > width + cellPx ||
        y < -cellPx ||
        y > height + cellPx
      ) {
        continue;
      }
      const tone = toneAt(
        x / width,
        y / height,
        settings,
        asset,
        imageMetrics,
      );
      const radius = Math.max(0.18, tone * cellPx * 0.49 * (settings.dotScale / 100));
      const textureSeed =
        material !== "smooth"
          ? materialSeed + column * 31.7 + row * 91.3
          : 0;
      callback(x, y, radius, textureSeed);
    }
  }
}

function latticeNoise(x: number, y: number, seed: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothNoise(
  x: number,
  y: number,
  seed: number,
  interpolation: NoiseInterpolation = "soft",
) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (interpolation === "block") return latticeNoise(x0, y0, seed);
  const tx = x - x0;
  const ty = y - y0;
  const sx = interpolation === "linear" ? tx : tx * tx * (3 - 2 * tx);
  const sy = interpolation === "linear" ? ty : ty * ty * (3 - 2 * ty);
  const top =
    latticeNoise(x0, y0, seed) * (1 - sx) +
    latticeNoise(x0 + 1, y0, seed) * sx;
  const bottom =
    latticeNoise(x0, y0 + 1, seed) * (1 - sx) +
    latticeNoise(x0 + 1, y0 + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
}

function evolvingNoise(
  x: number,
  y: number,
  seed: number,
  evolution: number,
  interpolation: NoiseInterpolation,
  cycleEvolution: boolean,
  cycle: number,
) {
  const revolutions = evolution / 360;
  const cycleLength = Math.max(1, Math.round(cycle));
  const state = cycleEvolution
    ? ((revolutions % cycleLength) + cycleLength) % cycleLength
    : Math.max(0, revolutions);
  const stateIndex = Math.floor(state);
  const nextIndex = cycleEvolution
    ? (stateIndex + 1) % cycleLength
    : stateIndex + 1;
  const blend = state - stateIndex;
  const smoothBlend = blend * blend * (3 - 2 * blend);
  const current = smoothNoise(
    x,
    y,
    seed + stateIndex * 101,
    interpolation,
  );
  const next = smoothNoise(
    x,
    y,
    seed + nextIndex * 101,
    interpolation,
  );
  return current * (1 - smoothBlend) + next * smoothBlend;
}

function shapeFractalValue(value: number, type: FractalType) {
  if (type === "turbulentSmooth") return 1 - Math.abs(value * 2 - 1);
  if (type === "turbulentSharp") {
    return Math.pow(1 - Math.abs(value * 2 - 1), 0.42);
  }
  return value;
}

function fractalNoise(
  x: number,
  y: number,
  complexity: number,
  seed: number,
  channel: ChannelState,
) {
  const clampedComplexity = clamp(complexity, 1, 8);
  const wholeOctaves = Math.floor(clampedComplexity);
  const partialOctave = clampedComplexity - wholeOctaves;
  let frequency = 1;
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  let maximum = 0;
  const octaveCount = wholeOctaves + (partialOctave > 0 ? 1 : 0);
  const frequencyMultiplier = 100 / clamp(channel.fractalSubScaling, 10, 400);
  const amplitudeMultiplier = clamp(channel.fractalLayerWeight / 100, 0, 1);

  for (let octave = 0; octave < octaveCount; octave += 1) {
    const octaveWeight =
      octave < wholeOctaves ? amplitude : amplitude * partialOctave;
    const subPoint = rotatePoint(
      x * frequency,
      y * frequency,
      channel.fractalSubRotation * octave,
    );
    const stringX = channel.fractalType === "strings" ? subPoint.x * 0.24 : subPoint.x;
    const stringY = channel.fractalType === "strings" ? subPoint.y * 2.6 : subPoint.y;
    const layerValue = shapeFractalValue(
      evolvingNoise(
        stringX + (channel.fractalSubOffsetX / 100) * octave,
        stringY + (channel.fractalSubOffsetY / 100) * octave,
        seed + octave * 17,
        channel.fractalEvolution,
        channel.fractalNoiseType,
        channel.fractalCycleEvolution,
        channel.fractalCycle,
      ),
      channel.fractalType,
    );
    total += layerValue * octaveWeight;
    maximum = Math.max(maximum, layerValue * (0.4 + octaveWeight * 0.6));
    weight += octaveWeight;
    frequency *= frequencyMultiplier;
    amplitude *= amplitudeMultiplier;
  }
  if (channel.fractalType === "max") return maximum;
  return weight > 0 ? total / weight : 0.5;
}

function remapNoiseOverflow(value: number, overflow: NoiseOverflow) {
  if (overflow === "softClamp") {
    return 0.5 + Math.tanh((value - 0.5) * 2) / 2;
  }
  if (overflow === "wrapBack") {
    const wrapped = ((value % 2) + 2) % 2;
    return wrapped <= 1 ? wrapped : 2 - wrapped;
  }
  return clamp(value, 0, 1);
}

function fractalErosionAt(
  channel: ChannelState,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (channel.material !== "fractal") return 0;

  const aspect = clamp(channel.fractalAspect / 100, 0.1, 10);
  const rotated = rotatePoint(
    (x / width - 0.5) / aspect,
    y / height - 0.5,
    channel.fractalAngle,
  );
  const scale = Math.max(0.05, channel.fractalScale / 100);
  const noise = fractalNoise(
    ((rotated.x + channel.fractalOffsetX / 100) * 4) / scale,
    ((rotated.y + channel.fractalOffsetY / 100) * 4) / scale,
    channel.fractalComplexity,
    channel.id.charCodeAt(0) + channel.fractalRandomSeed * 13,
    channel,
  );
  let adjusted = remapNoiseOverflow(
    (noise - 0.5) * (channel.fractalContrast / 100) +
      0.5 +
      channel.fractalBrightness / 100,
    channel.fractalOverflow,
  );
  if (channel.fractalInvert) adjusted = 1 - adjusted;
  return 1 - adjusted;
}

type MaterialHole = { x: number; y: number; radius: number };

function materialHoles(
  x: number,
  y: number,
  radius: number,
  amountPercent: number,
  seed: number,
  maximumCount = 8,
): MaterialHole[] {
  const amount = clamp(amountPercent / 100, 0, 1);
  if (amount <= 0 || radius <= 0.2) return [];
  const count = Math.max(1, Math.ceil(amount * maximumCount));

  return Array.from({ length: count }, (_, index) => {
    const angle = latticeNoise(index, 17, seed) * Math.PI * 2;
    const positionNoise = latticeNoise(index, 43, seed + 7);
    const edgeChip = index % 3 === 0;
    const distance = edgeChip
      ? radius * (0.82 + positionNoise * 0.28)
      : radius * (0.12 + positionNoise * 0.68);
    const sizeNoise = latticeNoise(index, 79, seed + 23);
    const holeRadius =
      radius * (0.035 + sizeNoise * 0.12) * (0.45 + amount * 0.9);
    return {
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      radius: Math.max(0.08, holeRadius),
    };
  });
}

function channelMaterialHoles(
  channel: ChannelState,
  x: number,
  y: number,
  radius: number,
  width: number,
  height: number,
  seed: number,
) {
  if (channel.material === "smooth") return [];
  if (channel.material === "mottled") {
    return materialHoles(x, y, radius, channel.materialAmount, seed);
  }

  const strength = clamp(channel.materialAmount / 100, 0, 2);
  if (strength <= 0) return [];

  // Keep candidate positions stable while every candidate samples the same
  // continuous, weighted multi-frequency field at its own world position.
  return materialHoles(x, y, radius, 100, seed, 18).flatMap((hole, index) => {
    const erosion = fractalErosionAt(
      channel,
      hole.x,
      hole.y,
      width,
      height,
    );
    const coverage = clamp(erosion * strength, 0, 1);
    const threshold = latticeNoise(index, 113, seed + 41);
    if (threshold > clamp(coverage * 1.8, 0, 1)) return [];
    return [
      {
        ...hole,
        radius: hole.radius * (0.3 + coverage * 2.15),
      },
    ];
  });
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

function traceMaterialHoles(
  context: CanvasRenderingContext2D,
  holes: MaterialHole[],
) {
  for (const hole of holes) {
    context.moveTo(hole.x + hole.radius, hole.y);
    context.arc(hole.x, hole.y, hole.radius, 0, Math.PI * 2);
  }
}

function drawCompositePattern(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  channels: ChannelState[],
  paper: string,
  sourceAsset: SourceAsset | null,
  imageMetrics: ImageMetrics,
) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "multiply";

  for (const channel of channels) {
    if (!channel.active || channel.strength <= 0) continue;
    const textured = channel.material !== "smooth";
    context.globalAlpha = channel.strength / 100;
    context.fillStyle = channel.settings.ink;
    if (!textured) context.beginPath();
    forEachDot(
      width,
      height,
      channel.settings,
      sourceAsset,
      imageMetrics,
      (x, y, radius, textureSeed) => {
        if (textured) {
          context.beginPath();
          traceDot(context, x, y, radius, channel.settings.dotShape);
          traceMaterialHoles(
            context,
            channelMaterialHoles(
              channel,
              x,
              y,
              radius,
              width,
              height,
              textureSeed,
            ),
          );
          context.fill("evenodd");
          return;
        }
        traceDot(context, x, y, radius, channel.settings.dotShape);
      },
      channel.offsetX,
      channel.offsetY,
      channel.material,
      channel.id.charCodeAt(0),
    );
    if (!textured) context.fill();
  }

  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
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

function svgCirclePath(x: number, y: number, radius: number) {
  return `M ${(x + radius).toFixed(2)} ${y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 1 0 ${(x - radius).toFixed(2)} ${y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 1 0 ${(x + radius).toFixed(2)} ${y.toFixed(2)} Z`;
}

function svgDotPath(x: number, y: number, radius: number, shape: DotShape) {
  if (shape === "circle") return svgCirclePath(x, y, radius);
  const sides = shape === "square" ? 4 : 6;
  const rotation = shape === "square" ? Math.PI / 4 : Math.PI / 6;
  const points = polygonPoints(x, y, radius, sides, rotation);
  return `M ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")} Z`;
}

function svgDot(
  x: number,
  y: number,
  radius: number,
  shape: DotShape,
  material: Material = "smooth",
  holes: MaterialHole[] = [],
) {
  if (material === "smooth") {
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

  const holePaths = holes
    .map((hole) => svgCirclePath(hole.x, hole.y, hole.radius))
    .join(" ");
  return `<path fill-rule="evenodd" d="${svgDotPath(x, y, radius, shape)} ${holePaths}"/>`;
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
  const inputId = useId();
  const numberInputRef = useRef<HTMLInputElement>(null);
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    if (document.activeElement !== numberInputRef.current) {
      setDraftValue(String(value));
    }
  }, [value]);

  const commitDraft = () => {
    const trimmed = draftValue.trim();
    const isCompleteNumber = /^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed);
    if (!isCompleteNumber) {
      setDraftValue(String(value));
      return;
    }
    const nextValue = Number(trimmed);
    if (Number.isFinite(nextValue)) {
      onChange(nextValue);
      setDraftValue(String(nextValue));
    }
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={inputId}>
        <span>{label}</span>
        <span className="field-number-control">
          <input
            ref={numberInputRef}
            type="text"
            inputMode="decimal"
            value={draftValue}
            aria-label={`${label}数值`}
            onChange={(event) => {
              const nextDraft = event.target.value;
              setDraftValue(nextDraft);
              if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(nextDraft.trim())) {
                const nextValue = Number(nextDraft);
                if (Number.isFinite(nextValue)) onChange(nextValue);
              }
            }}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraftValue(String(value));
                event.currentTarget.blur();
              }
            }}
          />
          <span>{suffix}</span>
        </span>
      </label>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamp(value, min, max)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function ChannelPatternControls({
  settings,
  update,
}: {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  return (
    <div className="channel-pattern-controls">
      <label className="field">
        <span className="field-label">重复单元形状</span>
        <select
          value={settings.dotShape}
          onChange={(event) =>
            update("dotShape", event.target.value as DotShape)
          }
        >
          <option value="circle">圆形</option>
          <option value="square">正方形</option>
          <option value="hexagon">六边形</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">重复方向</span>
        <select
          value={settings.lattice}
          onChange={(event) =>
            update("lattice", event.target.value as Lattice)
          }
        >
          <option value="square">四方平移 · 0° / 90°</option>
          <option value="hexagonal">
            六角平移 · 0° / 60° / 120°
          </option>
        </select>
      </label>
      <MetricSlider
        label="网格间距"
        value={settings.cellSize}
        suffix=" mm"
        min={2}
        max={10}
        step={0.1}
        onChange={(value) => update("cellSize", value)}
      />
      <MetricSlider
        label="网点大小"
        value={settings.dotScale}
        suffix="%"
        min={20}
        max={150}
        onChange={(value) => update("dotScale", value)}
      />
      <MetricSlider
        label="对比度"
        value={settings.contrast}
        suffix="%"
        min={20}
        max={100}
        onChange={(value) => update("contrast", value)}
      />
      <MetricSlider
        label="重复方向角度"
        value={settings.latticeAngle}
        suffix="°"
        min={-180}
        max={180}
        onChange={(value) => update("latticeAngle", value)}
      />
      <div className="toggle-row">
        反转明暗
        <button
          className="switch"
          type="button"
          role="switch"
          aria-checked={settings.invert}
          aria-label="反转明暗"
          onClick={() => update("invert", !settings.invert)}
        />
      </div>
    </div>
  );
}

function GaussianProfileChart({
  deltaRatio,
  minimum,
  maximum,
}: {
  deltaRatio: number;
  minimum: number;
  maximum: number;
}) {
  const points = Array.from({ length: 81 }, (_, index) => {
    const phase = index / 80;
    const value = periodicGaussian(phase, deltaRatio, minimum, maximum);
    return `${(phase * 280 + 20).toFixed(1)},${(112 - value * 88).toFixed(1)}`;
  }).join(" ");

  return (
    <figure className="profile-chart">
      <figcaption>
        <span>单周期渐变函数</span>
        <strong>GAUSSIAN</strong>
      </figcaption>
      <svg
        viewBox="0 0 320 136"
        role="img"
        aria-label={`一个周期内的周期高斯渐变函数，sigma 与周期比为 ${deltaRatio.toFixed(2)}`}
      >
        <line x1="20" y1="112" x2="300" y2="112" />
        <line x1="20" y1="20" x2="20" y2="112" />
        <line className="profile-midline" x1="160" y1="20" x2="160" y2="112" />
        <polyline points={points} />
        <text x="20" y="130">0</text>
        <text x="156" y="130">T/2</text>
        <text x="295" y="130">T</text>
      </svg>
      <div className="profile-chart-meta">
        <span>MIN {minimum}%</span>
        <span>σ/T {deltaRatio.toFixed(2)}</span>
        <span>MAX {maximum}%</span>
      </div>
    </figure>
  );
}

export default function HalftoneStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const [channels, setChannels] = useState<ChannelState[]>(createDefaultChannels);
  const [sourceAsset, setSourceAsset] = useState<SourceAsset | null>(null);
  const [imageMetrics, setImageMetrics] = useState<ImageMetrics>({
    ...DEFAULT_IMAGE_METRICS,
  });
  const [selectedChannelId, setSelectedChannelId] = useState<ChannelId>("C");
  const [expandedChannelId, setExpandedChannelId] =
    useState<ChannelId | null>(null);
  const [view, setView] = useState<View>("studio");
  const [uploadError, setUploadError] = useState("");
  const [loadingImage, setLoadingImage] = useState(false);
  const [exporting, setExporting] = useState(false);
  const sourceAssetRef = useRef(sourceAsset);
  const selectedChannel =
    channels.find((channel) => channel.id === selectedChannelId) ?? channels[0];
  const settings = selectedChannel.settings;

  const setSettings = useCallback(
    (next: React.SetStateAction<Settings>) => {
      setChannels((current) =>
        current.map((channel) =>
          channel.id === selectedChannelId
            ? {
                ...channel,
                settings:
                  typeof next === "function"
                    ? next(channel.settings)
                    : next,
              }
            : channel,
        ),
      );
    },
    [selectedChannelId],
  );

  const setSharedSettings = useCallback(
    (next: React.SetStateAction<Settings>) => {
      setChannels((current) => {
        const base = current[0]?.settings ?? DEFAULTS;
        const resolved = typeof next === "function" ? next(base) : next;
        return current.map((channel) => ({
          ...channel,
          settings: {
            ...channel.settings,
            pattern: resolved.pattern,
            widthMm: resolved.widthMm,
            heightMm: resolved.heightMm,
            paper: resolved.paper,
            waveAmplitude: resolved.waveAmplitude,
            wavePeriod: resolved.wavePeriod,
            waveDirection: resolved.waveDirection,
            gradientDirection: resolved.gradientDirection,
            radialRatio: resolved.radialRatio,
            radialAngle: resolved.radialAngle,
            radialPeriod: resolved.radialPeriod,
            gaussianDeltaRatio: resolved.gaussianDeltaRatio,
            periodicMin: resolved.periodicMin,
            periodicMax: resolved.periodicMax,
          },
        }));
      });
    },
    [],
  );

  const updateChannel = useCallback(
    (
      channelId: ChannelId,
      changes: Partial<
        Pick<
          ChannelState,
          | "active"
          | "strength"
          | "offsetX"
          | "offsetY"
          | "material"
          | "materialAmount"
          | "fractalType"
          | "fractalNoiseType"
          | "fractalOverflow"
          | "fractalInvert"
          | "fractalScale"
          | "fractalAspect"
          | "fractalComplexity"
          | "fractalLayerWeight"
          | "fractalSubScaling"
          | "fractalSubRotation"
          | "fractalSubOffsetX"
          | "fractalSubOffsetY"
          | "fractalContrast"
          | "fractalBrightness"
          | "fractalAngle"
          | "fractalEvolution"
          | "fractalOffsetX"
          | "fractalOffsetY"
          | "fractalRandomSeed"
          | "fractalCycleEvolution"
          | "fractalCycle"
        >
      >,
    ) => {
      setChannels((current) =>
        current.map((channel) =>
          channel.id === channelId ? { ...channel, ...changes } : channel,
        ),
      );
    },
    [],
  );

  const isPeriodicPattern =
    settings.pattern === "wave" || settings.pattern === "radial";

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
    if (view !== "studio") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const previewWidth = 1100;
    const previewHeight = Math.round(previewWidth * (settings.heightMm / settings.widthMm));
    drawCompositePattern(
      canvas,
      previewWidth,
      previewHeight,
      channels,
      settings.paper,
      sourceAsset,
      imageMetrics,
    );
  }, [
    view,
    channels,
    settings.heightMm,
    settings.widthMm,
    settings.paper,
    sourceAsset,
    imageMetrics,
  ]);

  useEffect(() => {
    if (view !== "editor" || settings.pattern === "image") return;
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    drawSourceField(
      canvas,
      settings,
      sourceAsset,
      imageMetrics,
    );
  }, [view, settings, sourceAsset, imageMetrics]);

  useEffect(() => {
    sourceAssetRef.current = sourceAsset;
  }, [sourceAsset]);

  useEffect(() => {
    return () => {
      if (sourceAssetRef.current) {
        URL.revokeObjectURL(sourceAssetRef.current.url);
      }
    };
  }, []);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, [setSettings]);

  const updateShared = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSharedSettings((current) => ({ ...current, [key]: value }));
    },
    [setSharedSettings],
  );

  const updateImageMetric = useCallback(
    <K extends keyof ImageMetrics>(key: K, value: ImageMetrics[K]) => {
      setImageMetrics((current) => ({ ...current, [key]: value }));
    },
    [setImageMetrics],
  );

  const resetCurrentModel = useCallback(() => {
    if (settings.pattern === "image") {
      setImageMetrics(DEFAULT_IMAGE_METRICS);
      return;
    }

    setSharedSettings((current) => {
      if (current.pattern === "wave") {
        return {
          ...current,
          waveAmplitude: DEFAULTS.waveAmplitude,
          wavePeriod: DEFAULTS.wavePeriod,
          waveDirection: DEFAULTS.waveDirection,
          gaussianDeltaRatio: DEFAULTS.gaussianDeltaRatio,
          periodicMin: DEFAULTS.periodicMin,
          periodicMax: DEFAULTS.periodicMax,
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
        gaussianDeltaRatio: DEFAULTS.gaussianDeltaRatio,
        periodicMin: DEFAULTS.periodicMin,
        periodicMax: DEFAULTS.periodicMax,
      };
    });
  }, [settings.pattern, setImageMetrics, setSharedSettings]);

  const resetChannel = useCallback((channelId: ChannelId) => {
    const preset = CHANNEL_PRESETS.find(
      (channel) => channel.id === channelId,
    );
    setChannels((current) =>
      current.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              strength: 100,
              offsetX: 0,
              offsetY: 0,
              material: "smooth",
              materialAmount: 45,
              fractalType: "turbulentSmooth",
              fractalNoiseType: "soft",
              fractalOverflow: "clip",
              fractalInvert: false,
              fractalScale: 100,
              fractalAspect: 100,
              fractalComplexity: 4,
              fractalLayerWeight: 50,
              fractalSubScaling: 50,
              fractalSubRotation: 0,
              fractalSubOffsetX: 0,
              fractalSubOffsetY: 0,
              fractalContrast: 125,
              fractalBrightness: 0,
              fractalAngle: 0,
              fractalEvolution: 0,
              fractalOffsetX: 0,
              fractalOffsetY: 0,
              fractalRandomSeed: 0,
              fractalCycleEvolution: false,
              fractalCycle: 2,
              settings: {
                ...channel.settings,
                dotShape: DEFAULTS.dotShape,
                lattice: DEFAULTS.lattice,
                cellSize: DEFAULTS.cellSize,
                dotScale: DEFAULTS.dotScale,
                contrast: DEFAULTS.contrast,
                latticeAngle: DEFAULTS.latticeAngle,
                invert: DEFAULTS.invert,
                ink: preset?.color ?? DEFAULTS.ink,
              },
            }
          : channel,
      ),
    );
  }, []);

  const uploadImage = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setUploadError("");
      setLoadingImage(true);
      try {
        const nextAsset = await loadSourceAsset(file);
        setSourceAsset(nextAsset);
        setSharedSettings((current) => ({ ...current, pattern: "image" }));
      } catch {
        setUploadError("图片读取失败，请换用 PNG、WebP 或 JPEG。");
      } finally {
        setLoadingImage(false);
        event.target.value = "";
      }
    },
    [setSharedSettings],
  );

  const exportPng = useCallback(async () => {
    setExporting(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    const canvas = document.createElement("canvas");
    drawCompositePattern(
      canvas,
      exportSize.width,
      exportSize.height,
      channels,
      settings.paper,
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
  }, [
    exportSize,
    settings.paper,
    settings.widthMm,
    settings.heightMm,
    channels,
    sourceAsset,
    imageMetrics,
  ]);

  const exportSvg = useCallback(() => {
    const width = Math.round(settings.widthMm * 10);
    const height = Math.round(settings.heightMm * 10);
    const groups = channels
      .filter((channel) => channel.active && channel.strength > 0)
      .map((channel) => {
        const elements: string[] = [];
        forEachDot(
          width,
          height,
          channel.settings,
          sourceAsset,
          imageMetrics,
          (x, y, radius, textureSeed) => {
            const holes = channelMaterialHoles(
              channel,
              x,
              y,
              radius,
              width,
              height,
              textureSeed,
            );
            elements.push(
              svgDot(
                x,
                y,
                radius,
                channel.settings.dotShape,
                channel.material,
                holes,
              ),
            );
          },
          channel.offsetX,
          channel.offsetY,
          channel.material,
          channel.id.charCodeAt(0),
        );
        return `<g data-channel="${channel.id}" fill="${escapeXml(channel.settings.ink)}" opacity="${channel.strength / 100}" style="mix-blend-mode:multiply">${elements.join("")}</g>`;
      })
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.widthMm}mm" height="${settings.heightMm}mm" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${escapeXml(settings.paper)}"/>${groups}</svg>`;
    downloadBlob(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      `halftone-cmyk-${settings.widthMm}x${settings.heightMm}mm.svg`,
    );
  }, [
    settings.widthMm,
    settings.heightMm,
    settings.paper,
    channels,
    sourceAsset,
    imageMetrics,
  ]);

  if (view === "editor") {
    const isImageEditor = settings.pattern === "image";
    return (
      <main className="editor-view">
        <header className="topbar editor-topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            {PATTERN_LABELS[settings.pattern]} / SHARED SOURCE EDITOR
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
              {isPeriodicPattern && (
                <div className="periodic-profile-editor">
                  <GaussianProfileChart
                    deltaRatio={settings.gaussianDeltaRatio}
                    minimum={settings.periodicMin}
                    maximum={settings.periodicMax}
                  />
                  <div className="profile-controls" aria-label="周期渐变函数参数">
                    <MetricSlider
                      label="σ / T"
                      value={settings.gaussianDeltaRatio}
                      suffix=""
                      min={0.03}
                      max={0.5}
                      step={0.01}
                      onChange={(value) => updateShared("gaussianDeltaRatio", value)}
                    />
                    <MetricSlider
                      label="最小值"
                      value={settings.periodicMin}
                      suffix="%"
                      min={0}
                      max={100}
                      onChange={(value) =>
                        updateShared("periodicMin", Math.min(value, settings.periodicMax))
                      }
                    />
                    <MetricSlider
                      label="最大值"
                      value={settings.periodicMax}
                      suffix="%"
                      min={0}
                      max={100}
                      onChange={(value) =>
                        updateShared("periodicMax", Math.max(value, settings.periodicMin))
                      }
                    />
                  </div>
                </div>
              )}
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
                  <MetricSlider label="波浪大小" value={settings.waveAmplitude} suffix="%" min={0} max={100} onChange={(value) => updateShared("waveAmplitude", value)} />
                  <MetricSlider label="波浪周期" value={settings.wavePeriod} suffix="" min={1} max={12} step={0.5} onChange={(value) => updateShared("wavePeriod", value)} />
                  <MetricSlider label="波浪方向" value={settings.waveDirection} suffix="°" min={-180} max={180} onChange={(value) => updateShared("waveDirection", value)} />
                </>
              )}
              {settings.pattern === "linear" && (
                <MetricSlider label="渐变方向" value={settings.gradientDirection} suffix="°" min={-180} max={180} onChange={(value) => updateShared("gradientDirection", value)} />
              )}
              {settings.pattern === "radial" && (
                <>
                  <MetricSlider label="椭圆形状" value={settings.radialRatio} suffix="×" min={0.4} max={2.5} step={0.1} onChange={(value) => updateShared("radialRatio", value)} />
                  <MetricSlider label="椭圆朝向" value={settings.radialAngle} suffix="°" min={0} max={180} onChange={(value) => updateShared("radialAngle", value)} />
                  <MetricSlider label="循环周期" value={settings.radialPeriod} suffix="" min={2} max={16} step={0.5} onChange={(value) => updateShared("radialPeriod", value)} />
                </>
              )}
            </div>

            <div className="editor-note">
              <strong>
                {isImageEditor
                  ? "透明底建议"
                  : isPeriodicPattern
                    ? "高斯周期函数"
                    : "原始场预览"}
              </strong>
              {isImageEditor
                ? "PNG 或 WebP 的透明背景能让轮廓更干净。Alpha 阈值越高，越多半透明边缘会被忽略。"
                : isPeriodicPattern
                  ? "σ/T 控制峰值宽度，并叠加相邻周期的高斯尾部；拉到 0.50 时会覆盖整个周期。最小值和最大值限定明暗范围。"
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
          <h1 id="complete-title">
            {selectedChannel.id} 通道已经准备好。
          </h1>
          <p>
            当前模型参数已经保存。返回生成器后，实时预览、PNG 与 SVG
            都会使用这组设置。
          </p>
          <dl className="complete-summary">
            <div>
              <dt>通道 / 模型</dt>
              <dd>
                {selectedChannel.id} · {PATTERN_LABELS[settings.pattern]}
              </dd>
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
            <div className="canvas-stage">
              <canvas
                ref={canvasRef}
                aria-label="实时半调图案预览"
                style={{ "--art-ratio": settings.widthMm / settings.heightMm } as React.CSSProperties}
              />
            </div>
          </div>

          <div className="preview-foot">
            <span>每一个重复单元都是独立矢量元素。</span>
            <span>文件只在你的浏览器中生成，不会上传。</span>
          </div>
        </section>

        <aside className="control-panel" aria-label="图案控制">
          <section className="channel-section" aria-labelledby="channel-title">
            <div className="channel-section-head">
              <h2 id="channel-title">通道</h2>
              <span>{channels.filter((channel) => channel.active).length} / 4 ACTIVE</span>
            </div>
            <div className="channel-grid">
              {channels.map((channel) => {
                const isSelected = channel.id === selectedChannelId;
                return (
                  <div
                    className={`channel-card${channel.active ? " is-active" : ""}${isSelected ? " is-selected" : ""}`}
                    key={channel.id}
                    style={
                      {
                        "--channel-color": channel.settings.ink,
                        "--channel-foreground":
                          channel.id === "Y" ? "#151513" : "#ffffff",
                      } as React.CSSProperties
                    }
                  >
                    <button
                      className="channel-card-open"
                      type="button"
                      aria-expanded={expandedChannelId === channel.id}
                      onClick={() => {
                        setSelectedChannelId(channel.id);
                        setExpandedChannelId((current) =>
                          current === channel.id ? null : channel.id,
                        );
                        setUploadError("");
                      }}
                    >
                      <strong>{channel.id}</strong>
                      <span>{channel.name}</span>
                    </button>
                    <label className="channel-strength">
                      <span>{channel.strength}%</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={channel.strength}
                        aria-label={`${channel.id} 通道强度`}
                        onChange={(event) =>
                          updateChannel(channel.id, {
                            strength: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                );
              })}
            </div>

            {expandedChannelId && (
              <div className="channel-dropdown">
                {(() => {
                  const channel =
                    channels.find((item) => item.id === expandedChannelId) ??
                    selectedChannel;
                  return (
                    <>
                      <button
                        className={`channel-activation${channel.active ? " is-active" : ""}`}
                        type="button"
                        onClick={() => {
                          updateChannel(channel.id, {
                            active: !channel.active,
                          });
                          setSelectedChannelId(channel.id);
                          setExpandedChannelId(null);
                        }}
                      >
                        <span>
                          {channel.active ? "停用通道" : "激活通道"}
                        </span>
                        <strong>{channel.id}</strong>
                      </button>
                      <ChannelPatternControls
                        settings={channel.settings}
                        update={(key, value) => {
                          setChannels((current) =>
                            current.map((item) =>
                              item.id === channel.id
                                ? {
                                    ...item,
                                    settings: {
                                      ...item.settings,
                                      [key]: value,
                                    },
                                  }
                                : item,
                            ),
                          );
                        }}
                      />
                      <div className="channel-material-controls">
                        <label className="field">
                          <span className="field-label">通道材质</span>
                          <select
                            value={channel.material}
                            onChange={(event) =>
                              updateChannel(channel.id, {
                                material: event.target.value as Material,
                              })
                            }
                          >
                            <option value="smooth">平滑矢量</option>
                            <option value="mottled">印刷斑驳</option>
                            <option value="fractal">分形杂色</option>
                          </select>
                        </label>
                        {channel.material !== "smooth" && (
                          <>
                            {channel.material === "mottled" && (
                              <MetricSlider
                                label="斑驳程度"
                                value={channel.materialAmount}
                                suffix="%"
                                min={0}
                                max={100}
                                onChange={(value) =>
                                  updateChannel(channel.id, {
                                    materialAmount: value,
                                  })
                                }
                              />
                            )}
                            {channel.material === "fractal" && (
                              <div className="fractal-controls">
                                <details className="fractal-group" open>
                                  <summary>01 / 基础噪声</summary>
                                  <div className="fractal-group-body">
                                    <label className="field">
                                      <span className="field-label">分形类型</span>
                                      <select
                                        value={channel.fractalType}
                                        onChange={(event) =>
                                          updateChannel(channel.id, {
                                            fractalType: event.target.value as FractalType,
                                          })
                                        }
                                      >
                                        <option value="basic">基础</option>
                                        <option value="turbulentSmooth">湍流 · 平滑</option>
                                        <option value="turbulentSharp">湍流 · 锐利</option>
                                        <option value="max">最大值</option>
                                        <option value="strings">丝状</option>
                                      </select>
                                    </label>
                                    <label className="field">
                                      <span className="field-label">噪声插值</span>
                                      <select
                                        value={channel.fractalNoiseType}
                                        onChange={(event) =>
                                          updateChannel(channel.id, {
                                            fractalNoiseType: event.target.value as NoiseInterpolation,
                                          })
                                        }
                                      >
                                        <option value="block">块状</option>
                                        <option value="linear">线性</option>
                                        <option value="soft">柔和</option>
                                      </select>
                                    </label>
                                    <MetricSlider
                                      label="复杂度 · 叠加层数"
                                      value={channel.fractalComplexity}
                                      suffix=""
                                      min={1}
                                      max={8}
                                      step={0.1}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalComplexity: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="随机种子"
                                      value={channel.fractalRandomSeed}
                                      suffix=""
                                      min={0}
                                      max={999}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalRandomSeed: value })
                                      }
                                    />
                                    <div className="toggle-row">
                                      反转杂色
                                      <button
                                        className="switch"
                                        type="button"
                                        role="switch"
                                        aria-checked={channel.fractalInvert}
                                        aria-label="反转杂色"
                                        onClick={() =>
                                          updateChannel(channel.id, {
                                            fractalInvert: !channel.fractalInvert,
                                          })
                                        }
                                      />
                                    </div>
                                  </div>
                                </details>

                                <details className="fractal-group" open>
                                  <summary>02 / 子级叠加</summary>
                                  <div className="fractal-group-body">
                                    <MetricSlider
                                      label="子级影响 · 每层权重"
                                      value={channel.fractalLayerWeight}
                                      suffix="%"
                                      min={0}
                                      max={100}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalLayerWeight: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="子级缩放 · 相对尺寸"
                                      value={channel.fractalSubScaling}
                                      suffix="%"
                                      min={10}
                                      max={400}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalSubScaling: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="子级旋转"
                                      value={channel.fractalSubRotation}
                                      suffix="°"
                                      min={-180}
                                      max={180}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalSubRotation: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="子级 X 偏移"
                                      value={channel.fractalSubOffsetX}
                                      suffix="%"
                                      min={-200}
                                      max={200}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalSubOffsetX: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="子级 Y 偏移"
                                      value={channel.fractalSubOffsetY}
                                      suffix="%"
                                      min={-200}
                                      max={200}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalSubOffsetY: value })
                                      }
                                    />
                                  </div>
                                </details>

                                <details className="fractal-group" open>
                                  <summary>03 / 变换</summary>
                                  <div className="fractal-group-body">
                                    <MetricSlider
                                      label="整体缩放"
                                      value={channel.fractalScale}
                                      suffix="%"
                                      min={5}
                                      max={1000}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalScale: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="宽度比例"
                                      value={channel.fractalAspect}
                                      suffix="%"
                                      min={10}
                                      max={500}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalAspect: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="旋转"
                                      value={channel.fractalAngle}
                                      suffix="°"
                                      min={-180}
                                      max={180}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalAngle: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="位置 X"
                                      value={channel.fractalOffsetX}
                                      suffix="%"
                                      min={-500}
                                      max={500}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalOffsetX: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="位置 Y"
                                      value={channel.fractalOffsetY}
                                      suffix="%"
                                      min={-500}
                                      max={500}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalOffsetY: value })
                                      }
                                    />
                                  </div>
                                </details>

                                <details className="fractal-group" open>
                                  <summary>04 / 演化</summary>
                                  <div className="fractal-group-body">
                                    <MetricSlider
                                      label="演化"
                                      value={channel.fractalEvolution}
                                      suffix="°"
                                      min={0}
                                      max={3600}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalEvolution: value })
                                      }
                                    />
                                    <div className="toggle-row">
                                      循环演化
                                      <button
                                        className="switch"
                                        type="button"
                                        role="switch"
                                        aria-checked={channel.fractalCycleEvolution}
                                        aria-label="循环演化"
                                        onClick={() =>
                                          updateChannel(channel.id, {
                                            fractalCycleEvolution: !channel.fractalCycleEvolution,
                                          })
                                        }
                                      />
                                    </div>
                                    {channel.fractalCycleEvolution && (
                                      <MetricSlider
                                        label="循环周期"
                                        value={channel.fractalCycle}
                                        suffix=" 转"
                                        min={1}
                                        max={10}
                                        onChange={(value) =>
                                          updateChannel(channel.id, { fractalCycle: value })
                                        }
                                      />
                                    )}
                                  </div>
                                </details>

                                <details className="fractal-group" open>
                                  <summary>05 / 输出映射</summary>
                                  <div className="fractal-group-body">
                                    <MetricSlider
                                      label="侵蚀量"
                                      value={channel.materialAmount}
                                      suffix="%"
                                      min={0}
                                      max={200}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { materialAmount: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="对比度"
                                      value={channel.fractalContrast}
                                      suffix="%"
                                      min={-200}
                                      max={500}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalContrast: value })
                                      }
                                    />
                                    <MetricSlider
                                      label="亮度"
                                      value={channel.fractalBrightness}
                                      suffix="%"
                                      min={-200}
                                      max={200}
                                      onChange={(value) =>
                                        updateChannel(channel.id, { fractalBrightness: value })
                                      }
                                    />
                                    <label className="field">
                                      <span className="field-label">溢出方式</span>
                                      <select
                                        value={channel.fractalOverflow}
                                        onChange={(event) =>
                                          updateChannel(channel.id, {
                                            fractalOverflow: event.target.value as NoiseOverflow,
                                          })
                                        }
                                      >
                                        <option value="clip">剪切</option>
                                        <option value="softClamp">柔和限制</option>
                                        <option value="wrapBack">回绕</option>
                                      </select>
                                    </label>
                                  </div>
                                </details>
                              </div>
                            )}
                            <p className="material-note">
                              {channel.material === "fractal"
                                ? "复杂度决定层数，子级影响决定权重，子级缩放决定下一层尺寸；演化只改变噪声形态，不移动网点。"
                                : "在网点内部生成颗粒孔洞与破损边缘；预览和导出保持一致。"}
                            </p>
                          </>
                        )}
                      </div>
                      <button
                        className="reset channel-reset"
                        type="button"
                        onClick={() => resetChannel(channel.id)}
                      >
                        恢复此通道默认参数
                      </button>
                      <div className="channel-offsets">
                        <MetricSlider
                          label="网格 X 偏移"
                          value={channel.offsetX}
                          suffix="%"
                          min={-50}
                          max={50}
                          onChange={(value) =>
                            updateChannel(channel.id, { offsetX: value })
                          }
                        />
                        <MetricSlider
                          label="网格 Y 偏移"
                          value={channel.offsetY}
                          suffix="%"
                          min={-50}
                          max={50}
                          onChange={(value) =>
                            updateChannel(channel.id, { offsetY: value })
                          }
                        />
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </section>

          <section className="control-section global-source-section">
            <h3>图案结构 · 所有通道共用</h3>
            <div className="control-grid">
              <label className="field">
                <span className="field-label">生成模型</span>
                <select value={settings.pattern} onChange={(event) => updateShared("pattern", event.target.value as Pattern)}>
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
                    onChange={(value) => updateShared("waveAmplitude", value)}
                  />
                  <MetricSlider
                    label="波浪周期"
                    value={settings.wavePeriod}
                    suffix=""
                    min={1}
                    max={12}
                    step={0.5}
                    onChange={(value) => updateShared("wavePeriod", value)}
                  />
                  <MetricSlider
                    label="波浪方向"
                    value={settings.waveDirection}
                    suffix="°"
                    min={-180}
                    max={180}
                    onChange={(value) => updateShared("waveDirection", value)}
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
                    onChange={(value) => updateShared("gradientDirection", value)}
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
                    onChange={(value) => updateShared("radialRatio", value)}
                  />
                  <MetricSlider
                    label="椭圆朝向"
                    value={settings.radialAngle}
                    suffix="°"
                    min={0}
                    max={180}
                    onChange={(value) => updateShared("radialAngle", value)}
                  />
                  <MetricSlider
                    label="循环周期"
                    value={settings.radialPeriod}
                    suffix=""
                    min={2}
                    max={16}
                    step={0.5}
                    onChange={(value) => updateShared("radialPeriod", value)}
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

            </div>
          </section>

          <section className="control-section">
            <h3>成品规格</h3>
            <div className="control-grid">
              <div className="dimension-row">
                <label className="small-label">
                  宽度 / mm
                  <input type="number" min="30" max="400" value={settings.widthMm} onChange={(event) => updateShared("widthMm", clamp(Number(event.target.value), 30, 400))} />
                </label>
                <label className="small-label">
                  高度 / mm
                  <input type="number" min="30" max="400" value={settings.heightMm} onChange={(event) => updateShared("heightMm", clamp(Number(event.target.value), 30, 400))} />
                </label>
              </div>
              <div className="color-row">
                <label className="small-label">
                  油墨
                  <input className="color-control" type="color" value={settings.ink} onChange={(event) => update("ink", event.target.value)} />
                </label>
                <label className="small-label">
                  纸张
                  <input className="color-control" type="color" value={settings.paper} onChange={(event) => updateShared("paper", event.target.value)} />
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
