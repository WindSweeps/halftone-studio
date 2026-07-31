# HALFTONE / LAB

一个在浏览器中运行的半调图案生成器。可使用程序化模型或自己的透明底图片生成图案，并导出 SVG 矢量图或带 300 ppi 元数据的 PNG。

在线使用：[GitHub Pages](https://windsweeps.github.io/halftone-studio/)

## 功能

- 四种生成模型：流动波纹、径向脉冲、线性渐变、上传图片
- 图片工作流包含原始 Alpha 预览、亮度、对比度、Alpha 阈值、缩放与位移编辑
- 波浪支持大小、周期与方向；渐变支持方向；径向脉冲支持椭圆比例、朝向与循环周期
- 波浪与径向脉冲使用可编辑的周期高斯渐变函数，支持 σ/T、最小值与最大值
- 三种重复单元形状：圆形、正方形、六边形
- 网点大小支持最高 150%，可通过网点重叠等效调整通道范围
- 四方平移与六角三方向平移两种重复晶格
- 重复方向角度默认 0°，用于旋转四方或六角晶格，不影响生成模型自身方向
- SVG 使用毫米尺寸与独立圆点元素
- PNG 按物理尺寸生成并写入 300 ppi
- 全部在本地浏览器中处理，不上传作品
- 响应式界面，支持键盘焦点与减少动态效果偏好

## 本地运行

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm build
```

GitHub Pages 静态构建：

```bash
GITHUB_ACTIONS=true \
NEXT_PUBLIC_SITE_URL=https://windsweeps.github.io/halftone-studio \
pnpm build:pages
```
