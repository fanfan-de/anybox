---
name: anybox-frontend-guidelines
description: Anybox 桌面端前端 UI 规范与实现流程。当 Codex 需要设计、实现、评审或重构 Anybox React/Electron/Vite 渲染层界面时使用，包括 workbench pane、侧边栏、ThreadView、composer、设置页、插件/MCP/skills 页面、菜单、表单、CSS token、响应式行为、视觉一致性和前端 UI 文档维护。
---

# Anybox 前端规范

## 核心流程

1. 修改前先阅读目标 UI 代码。优先沿用已有组件结构、class 命名、CSS 归属和 token 用法，不要先发明新抽象。
2. 只读取当前任务需要的 reference：
   - 产品整体风格：`references/principles.md`
   - token、CSS 归属、主题规则：`references/tokens-and-css.md`
   - shell、pane、sidebar、surface：`references/layout-and-surfaces.md`
   - 按钮、菜单、控件、列表行：`references/controls-and-menus.md`
   - 槽位式卡片列表交互：`references/slot-card-list.md`
   - ThreadView、trace、side chat、composer 嵌套：`references/thread-view.md`
   - 设置、插件、MCP、global skills 页面：`references/settings-and-management.md`
   - UI 修改完成前检查：`references/implementation-checklist.md`
3. 以本地项目文件和可执行校验为事实来源。常用入口：
   - `C:/Projects/Anybox/packages/desktop/src/shared/appearance-token-manifest.json`
   - `C:/Projects/Anybox/packages/desktop/scripts/generate-appearance-tokens.mjs`
   - `C:/Projects/Anybox/packages/desktop/src/renderer/src/styles/tokens.css`
   - `C:/Projects/Anybox/packages/desktop/src/renderer/src/styles/primitives.css`
   - `C:/Projects/Anybox/packages/desktop/src/renderer/src/styles/shell.css`
   - `C:/Projects/Anybox/packages/desktop/src/renderer/src/styles/sidebar.css`
   - `C:/Projects/Anybox/packages/desktop/src/renderer/src/styles/workbench.css`
   - `C:/Projects/Anybox/packages/desktop/src/renderer/src/styles/thread.css`
   - `C:/Projects/Anybox/packages/desktop/src/renderer/src/styles/composer.css`
   - `C:/Projects/Anybox/packages/desktop/src/renderer/src/styles/settings.css`
   - `C:/Projects/Anybox/packages/desktop/src/renderer/src/styles/responsive.css`
4. 保持改动范围收敛。优先改 token 或局部语义 class，不要追加文件末尾的大范围覆盖规则。
5. 最终回复前检查亮色/暗色主题、窄窗口、键盘焦点、溢出和相关测试。

## 撰写 UI 规范的元规则

新增或改写本 skill 的 UI 组件/交互 reference 时，必须让规范自包含这些主题与 token 约束，不要只依赖通用 token 文档：

- 明确 light 和 dark 双主题都必须支持。
- 明确组件 CSS 只消费不带 `-light` / `-dark` 后缀的运行时 token。
- 明确 semantic token 的命名、fallback 与 light/dark 映射规则。
- 明确缺少合适 token 时，先在 schema v2 manifest 补充成对 light/dark semantic token，再运行生成器；不要在 `tokens.css` 创建第二份颜色定义。
- 明确公开主题值只允许 DTCG `literal` 或 mode-token `alias`；内部 blend 仅用于无法由 literal/alias 表达的受控派生，并禁止组件直接消费 `--mix-*`。
- 明确 default、hover、focus、active、disabled、selected/current、error/invalid 等状态都要在明暗主题下可读。
- 明确禁止硬编码颜色和硬编码 fallback，例如 `#fff`、`#000`、固定灰色、固定品牌色或 `rgba(...)`。
- 明确 focus 使用组件自身的背景、边框、文字、指示器等 token 化状态表达，不使用 outline 或 inset ring。

## 项目文档来源

任务涉及对应区域时读取这些项目文档：

- `C:/Projects/Anybox/docs/thread-view-frontend-design.md`
- `C:/Projects/Anybox/docs/thread-view-render-flow.html`
- `C:/Projects/Anybox/packages/desktop/anybox-mobile-client-design-plan.md`
- `C:/Projects/Anybox/docs/todo-calendar-design.md`

如果 UI 行为变更导致这些文档过期，需要在同一次改动里同步更新。
