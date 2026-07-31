import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server renders the halftone studio shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /HALFTONE/);
  assert.match(html, /半调图案生成器/);
  assert.match(html, /导出 PNG/);
  assert.match(html, /导出 SVG/);
  assert.match(html, /重复单元形状/);
  assert.match(html, /六角平移/);
  assert.match(html, /上传自己的图片/);
  assert.match(html, /波浪大小/);
  assert.match(html, /开始编辑/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("includes the image editor flow and model-specific metrics", async () => {
  const source = await readFile(
    new URL("../app/HalftoneStudio.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /开始编辑/);
  assert.match(source, /原始 Alpha 图片/);
  assert.match(source, /完成编辑/);
  assert.match(source, /应用并返回生成器/);
  assert.match(source, /渐变方向/);
  assert.match(source, /椭圆形状/);
  assert.match(source, /椭圆朝向/);
  assert.match(source, /循环周期/);
  assert.match(source, /Original source field/);
  assert.match(source, /NO HALFTONE DOTS/);
  assert.match(source, /if \(view === "editor"\)/);
  assert.match(source, /if \(view === "complete"\)/);
  assert.match(source, /\[view, settings, sourceAsset, imageMetrics\]/);
  assert.match(source, /单周期渐变函数/);
  assert.match(source, /GAUSSIAN/);
  assert.match(source, /σ \/ T/);
  assert.match(source, /periodicGaussian/);
  assert.match(source, /periodOffset = -4/);
  assert.match(source, /max="150".*settings\.dotScale/);
  assert.match(source, /latticeAngle: 0/);
  assert.match(source, /重复方向角度/);
  assert.match(source, /settings\.latticeAngle/);
  assert.doesNotMatch(source, /settings\.angle/);
});
