# Design QA history

This file keeps earlier homepage QA evidence. The final result at the bottom is the status of the current review.

## 2026-07-21 — Homepage streaming demo split layout

### Evidence

- Source visual truth: `C:\Users\19128\AppData\Local\Temp\codex-clipboard-b6ebf7ed-9ab0-42a4-b621-b376e4d62403.png`
- Requested delta: replace the stacked heading/video composition with a desktop left/right split where video holds the majority and supporting copy sits beside it.
- Desktop implementation: `C:\Users\19128\AppData\Local\Temp\anybox-site-layout-qa-20260721\second-screen-desktop-2528-v4.png`
- Mobile implementation: `C:\Users\19128\AppData\Local\Temp\anybox-site-layout-qa-20260721\second-screen-mobile.png`
- Full-view comparison: `C:\Users\19128\AppData\Local\Temp\anybox-site-layout-qa-20260721\reference-vs-left-right-v2.png`
- Focused copy comparison: `C:\Users\19128\AppData\Local\Temp\anybox-site-layout-qa-20260721\focused-copy-comparison.png`
- Desktop viewport: 2528 × 1176, Chinese, dark theme, second homepage section, video paused at 12 seconds for deterministic visual comparison.
- Mobile viewport: 390 × 844, Chinese, dark theme, stacked responsive state.

### Findings

- No remaining P0, P1, or P2 issues.
- Typography: the existing Segoe UI Variable / Microsoft YaHei UI stack, strong display weight, compact line height, and lime kicker match the source visual language. The right-column title wraps as a deliberate two-line block without clipping.
- Spacing and layout rhythm: desktop uses an approximately 70/30 media-to-copy split with a clear central gutter. The media remains the dominant visual. Mobile returns to a single-column flow with no horizontal overflow or clipped controls.
- Colors and visual tokens: the implementation retains the source black stage, subdued blue/pink ambient glow, white display type, muted supporting text, and lime status accent through existing project tokens.
- Image quality and asset fidelity: the supplied 2560 × 1440 H.264 product recording and its real poster asset are reused without stretching, replacement art, or destructive cropping. The 16:9 frame remains intact.
- Copy and content: the original headline and explanation are preserved. Three short supporting points add useful information to the newly available copy column without changing the product claim.
- Interaction and accessibility: play/pause was tested through the visible control (`playing → paused → playing`). The video still pauses outside the viewport and honors reduced-motion preferences. No browser console errors were observed.

### Comparison History

1. Initial split-layout capture kept the section capped at 1600px. At the 2528px source viewport, this left too much unused horizontal space and made the product recording noticeably smaller than the visual target (P2).
2. The section cap was increased to 1960px while retaining the 1.9fr / 0.7fr grid. The revised capture gives the video a 1362px rendered width, keeps the copy at a readable 440px maximum, and restores the intended dominant-media balance.
3. Post-fix evidence is recorded in `second-screen-desktop-2528-v4.png` and `reference-vs-left-right-v2.png`; the P2 issue is resolved.

### Focused Review

The focused comparison checks headline weight and wrapping, kicker color, body contrast, supporting-list density, divider opacity, and copy alignment. A separate media crop was unnecessary because the same supplied video asset and unchanged 16:9 frame are used in both layouts.

### Follow-up Polish

- P3: if the copy changes substantially later, reassess the 980px stacking breakpoint so translated text does not make the second screen unnecessarily tall.

Historical result: passed

---

# 2026-08-10 — Anybox 产品首页 Kimi Work 布局参考

- 日期：2026-08-10
- 实现入口：`http://127.0.0.1:5176/?lang=zh`
- 参考页面：Kimi Work 产品页
- 视觉方向：保留 Anybox 的安静纸面语言，借鉴参考页的长页叙事结构，不做逐像素复刻。

## 参考证据

- 首屏：`C:\Users\19128\.codex\visualizations\2026\08\09\019fe4aa-bf5b-79b3-b883-764d36119285\kimi-anybox-audit\02-kimi-top.jpg`
- 产品总览与场景：`03-kimi-local-agent.jpg`、`04-kimi-automation.jpg`
- FAQ：`09-kimi-faq.jpg`
- Anybox 产品图：`public/product-preview.png`
- Anybox 场景图：`public/scenario-code-workflow.webp`、`public/scenario-office-workflow.webp`、`public/scenario-creative-workflow.webp`

## 已检查内容

- 页面结构：产品总览、实时工作流、实时构建、插件架构、三类成果场景、本地与权限、开源信任、最终 CTA、FAQ。
- 内容：中英文结构数量对齐，场景图均有替代文本，插件与权限链接对应现有文档路由。
- 状态与交互：下载平台菜单支持按钮展开与 Escape 关闭；FAQ 使用原生 `details`，首项默认展开且各项可独立切换；移动导航已有独立测试。
- 响应式规则：980px 下双栏转单栏，640px 下标题、按钮、信号列表、流程列表与场景布局重新排版。
- 图片质量：产品截图与三张 16:9 场景图尺寸、主体和清晰度可用于当前版面，无需空白占位。

## 已修复问题

- P2 / 行为：插件示例 hover 原本会改变左内边距，造成文字横向跳动；已改为只变更背景与文字颜色。
- P2 / 行为：FAQ 首项原本可能在异步仓库信息刷新后重新打开；已改为独立状态管理。
- P2 / 布局：场景图和产品图改为块级渲染，避免行内图片基线产生细小空隙。

## 验证结果

- `npm test -- --reporter=verbose`：7 个测试文件、19 个测试全部通过。
- `npm run build`：TypeScript 检查与 Vite 生产构建通过。
- 本地 HTTP：中文首页、产品截图和三张场景图均返回 200。
- `git diff --check -- .`：无空白错误，仅有仓库既有的 LF/CRLF 提示。

## 视觉验收限制

应用内浏览器的自动化标签页是在开发服务器启动前生成的错误页。浏览器安全策略禁止从该 `data:` 错误页导航或读取 DOM，因此本轮无法捕获实现后的桌面与移动截图，也无法把参考图和实现图放入同一次视觉对比输入。当前浏览器中的本地预览仍可由用户直接查看，但在取得实现截图前不能诚实标记为视觉 QA 通过。

final result: blocked
