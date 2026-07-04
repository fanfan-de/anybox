# 右键菜单 / 上下文菜单

## 视觉约定

将右键菜单设计为紧凑的浮动工具型界面：

- 宽度：默认 184px 到 260px；允许 `max-width: min(320px, calc(100vw - 16px))`。图标 + 短标签的应用选择菜单优先用 `width: max-content` 或 `fit-content` 按最长项自动推断宽度，不继承通用菜单的 184px/220px `min-width`；这类菜单使用 `min-width: 0` 或很小的内容下限，并保留视口内的 `max-width`，避免 hover 背景右侧出现大块空白。
- 内边距：外层 6px；菜单项之间 2px 到 4px。
- 圆角：外层菜单窗口默认 8px，或使用本地 menu/dropdown radius token；如果只有小圆角 token，可在该 token 基础上增加约 2px。菜单项圆角比外层少 1px 到 2px。
- 边框：1px 细边框，使用本地 border token。
- 表面：使用本地下拉菜单或 elevated surface token。
- Hover：优先复用语义化 tree/list row hover surface 与 hover text token，保持菜单和侧栏列表交互一致。
- 默认状态：菜单项背景保持透明；只有 hover、focus、selected、active 或 highlighted 状态显示背景。
- 字体：使用应用全局 font family token；菜单项默认 13px、500 weight，除非本地组件体系已有更具体规则。
- 阴影：使用一个中等强度浮层阴影；避免叠加多层阴影。
- 行高：桌面端紧凑 UI 最小 32px；如果需要兼顾触控，最小 36px。
- 图标槽：固定 16px 方形，颜色使用 `currentColor`。
- 标签：单行显示，超出省略。
- 快捷键或状态词：使用弱化颜色，等宽数字，右对齐。解释性说明不要常驻占行，优先放入 hover tooltip、`title` 或 `aria-describedby`。
- 分割线：1px 线条，上下 4px 到 6px 间距。
- 滚动条：短菜单默认不滚动、不显示也不预留右侧滚动条槽位。只有长菜单或动态菜单项可能超过视口时，才启用内部滚动；紧凑弹层即使需要滚动，也优先隐藏可见 scrollbar，让滚轮、触控板和键盘继续可用，但不要在右侧出现拖动条或空白槽位。只有布局确实会因为滚动条出现而抖动且产品接受可见槽位时，才使用稳定 gutter。

## Token 映射

按以下优先级使用本地 token：

```css
--context-menu-surface: var(--semantic-dropdown-menu-surface, var(--seg-dropdown-menu-surface, var(--surface-elevated, #ffffff)));
--context-menu-border: var(--seg-border, var(--border-default, rgba(17, 24, 39, 0.12)));
--context-menu-text: var(--seg-text-1, var(--text-primary, #1f2937));
--context-menu-muted: var(--seg-text-2, var(--text-secondary, #6b7280));
--context-menu-hover: var(--semantic-sidebar-tree-row-surface-hover, rgba(17, 24, 39, 0.06));
--context-menu-hover-text: var(--semantic-sidebar-tree-row-text-hover, var(--context-menu-text));
--context-menu-danger-text: var(--semantic-error-text, var(--seg-danger-text, #b42318));
--context-menu-danger-hover: var(--semantic-error-surface, var(--seg-danger-surface, rgba(180, 35, 24, 0.08)));
--context-menu-radius: var(--semantic-dropdown-menu-radius, var(--seg-radius-md, calc(var(--seg-radius-xs, 6px) + 2px)));
--context-menu-focus: var(--focus-outline-color, rgba(212, 107, 99, 0.32));
--context-menu-shadow: var(--ui-shadow-md, var(--shadow-md, 0 14px 34px rgba(17, 24, 39, 0.14)));
```

在 `fanfande_studio` 中，这套映射天然对应已有 renderer token：`--semantic-dropdown-menu-surface`、`--seg-border`、`--seg-text-1`、`--seg-text-2`、`--semantic-sidebar-tree-row-surface-hover`、`--semantic-sidebar-tree-row-text-hover`、`--semantic-error-text`、`--semantic-error-surface`、`--ui-shadow-md` 和 `--seg-radius-md`。

## CSS 模板

新增共享基础组件时使用中性的类名。只有目标应用已有基础组件命名规范时才重命名。

```css
.ui-context-menu {
  --context-menu-surface: var(--semantic-dropdown-menu-surface, var(--seg-dropdown-menu-surface, var(--surface-elevated, #ffffff)));
  --context-menu-border: var(--seg-border, var(--border-default, rgba(17, 24, 39, 0.12)));
  --context-menu-text: var(--seg-text-1, var(--text-primary, #1f2937));
  --context-menu-muted: var(--seg-text-2, var(--text-secondary, #6b7280));
  --context-menu-hover: var(--semantic-sidebar-tree-row-surface-hover, rgba(17, 24, 39, 0.06));
  --context-menu-hover-text: var(--semantic-sidebar-tree-row-text-hover, var(--context-menu-text));
  --context-menu-danger-text: var(--semantic-error-text, var(--seg-danger-text, #b42318));
  --context-menu-danger-hover: var(--semantic-error-surface, var(--seg-danger-surface, rgba(180, 35, 24, 0.08)));
  --context-menu-radius: var(--semantic-dropdown-menu-radius, var(--seg-radius-md, calc(var(--seg-radius-xs, 6px) + 2px)));
  --context-menu-focus: var(--focus-outline-color, rgba(212, 107, 99, 0.32));
  --context-menu-shadow: var(--ui-shadow-md, var(--shadow-md, 0 14px 34px rgba(17, 24, 39, 0.14)));

  position: fixed;
  z-index: 1000;
  min-width: 184px;
  max-width: min(320px, calc(100vw - 16px));
  max-height: min(360px, calc(100dvh - 16px));
  overflow: hidden;
  display: grid;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--context-menu-border);
  border-radius: var(--context-menu-radius);
  background: var(--context-menu-surface);
  color: var(--context-menu-text);
  box-shadow: var(--context-menu-shadow);
  transform-origin: var(--context-menu-origin, top left);
  animation: ui-context-menu-in 120ms ease;
}

.ui-context-menu__item {
  width: 100%;
  min-height: 32px;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border: 0;
  border-radius: max(4px, calc(var(--context-menu-radius) - 2px));
  background: transparent;
  color: inherit;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  text-align: left;
}

.ui-context-menu__item:hover,
.ui-context-menu__item:focus-visible,
.ui-context-menu__item[data-highlighted="true"] {
  background: var(--context-menu-hover);
  color: var(--context-menu-hover-text);
  outline: none;
}

.ui-context-menu__item:focus-visible {
  box-shadow: inset 0 0 0 1px var(--context-menu-focus);
}

.ui-context-menu__item:disabled,
.ui-context-menu__item[aria-disabled="true"] {
  opacity: 0.48;
  cursor: default;
}

.ui-context-menu__item[data-variant="danger"] {
  color: var(--context-menu-danger-text);
}

.ui-context-menu__item[data-variant="danger"]:hover,
.ui-context-menu__item[data-variant="danger"]:focus-visible,
.ui-context-menu__item[data-variant="danger"][data-highlighted="true"] {
  background: var(--context-menu-danger-hover);
  color: var(--context-menu-danger-text);
}

.ui-context-menu__icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
}

.ui-context-menu__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-context-menu__shortcut {
  justify-self: end;
  color: var(--context-menu-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.ui-context-menu__divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--context-menu-border);
}

@keyframes ui-context-menu-in {
  from {
    opacity: 0;
    transform: scale(0.98) translateY(-2px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-context-menu {
    animation: none;
  }
}
```

### 内容自适应短菜单

用于“图标 + 短文本”的应用选择、编辑器选择等短菜单。此变体让面板按最长菜单项推断宽度；所有菜单项的 hover 背景必须统一铺满这个面板宽度，不能每一行按自己的文字长度变化。

```css
.ui-context-menu--fit {
  width: max-content;
  min-width: 0;
  max-width: min(240px, calc(100vw - 16px));
}

.ui-context-menu--fit .ui-context-menu__item {
  width: 100%;
  max-width: calc(100vw - 28px);
}
```

## 带搜索框的菜单

当按钮弹层需要搜索或过滤（例如技能、命令、长列表选择器）时，继续复用上面的菜单 token，不要另起一套 hover/active 颜色。

- 外层仍使用菜单 surface、border、shadow 和 radius；搜索框 radius 比外层少 1px 到 2px。
- 搜索框放在顶部，结果列表放在下面；只有结果列表需要时才滚动，外层默认 `overflow: hidden`。结果列表不要显示右侧拖动条，也不要预留固定滚动条槽位。
- 搜索框高度建议 32px，使用透明或同色 surface，focus 用 `--context-menu-focus` 的内描边，不要添加额外背景块。
- 结果项继续使用 `.ui-context-menu__item` 的默认透明态、hover/focus/selected 背景、单行省略和稳定行高。
- 语义建议使用 `role="dialog"` 包含 `type="search"` 输入框和 `role="listbox"` 结果区；多选项使用 `aria-selected` 或 `aria-checked`，普通动作菜单才使用 `role="menu"`。
- placeholder 要短，例如 `Search skills` 或 `搜索技能`；不要在弹层内常驻解释搜索方式的说明文字。

```css
.ui-search-menu {
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.ui-search-menu__search {
  padding: 0 0 6px;
  background: var(--context-menu-surface);
}

.ui-search-menu__input {
  width: 100%;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--context-menu-border);
  border-radius: max(4px, calc(var(--context-menu-radius) - 2px));
  background: transparent;
  color: var(--context-menu-text);
  font: inherit;
}

.ui-search-menu__input:focus {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--context-menu-focus);
}

.ui-search-menu__list {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: grid;
  gap: 2px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.ui-search-menu__list::-webkit-scrollbar {
  width: 0;
  height: 0;
}
```

## React 结构

将渲染逻辑和定位逻辑分开。优先复用应用已有的菜单状态管理；如果没有现成模式，使用下面的结构。

```tsx
type ContextMenuItem = {
  id: string
  label: string
  icon?: React.ReactNode
  shortcut?: string
  disabled?: boolean
  variant?: "default" | "danger"
  onSelect: () => void
}

type ContextMenuState = {
  x: number
  y: number
  items: ContextMenuItem[]
} | null
```

可用 portal 时，将菜单渲染到 `document.body`：

```tsx
function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  if (!menu) return null

  return createPortal(
    <div
      className="ui-context-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose()
      }}
    >
      {menu.items.map((item) => (
        <button
          key={item.id}
          className="ui-context-menu__item"
          role="menuitem"
          type="button"
          disabled={item.disabled}
          data-variant={item.variant ?? "default"}
          onClick={() => {
            if (item.disabled) return
            item.onSelect()
            onClose()
          }}
        >
          <span className="ui-context-menu__icon" aria-hidden="true">{item.icon}</span>
          <span className="ui-context-menu__label">{item.label}</span>
          {item.shortcut ? <span className="ui-context-menu__shortcut">{item.shortcut}</span> : null}
        </button>
      ))}
    </div>,
    document.body,
  )
}
```

## 定位规则

菜单测量完成后，将位置限制在视口内。如果当前任务不值得做完整测量，可以使用保守估算，并在视口边缘留出安全距离。

```ts
function clampContextMenuPosition(x: number, y: number, width: number, height: number) {
  const margin = 8
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
  }
}
```

从 `contextmenu` 事件打开菜单时：

```tsx
function handleContextMenu(event: React.MouseEvent) {
  if (event.target instanceof HTMLElement) {
    const editable = event.target.closest("input, textarea, [contenteditable='true'], webview")
    if (editable) return
  }

  event.preventDefault()
  setMenu({ x: event.clientX, y: event.clientY, items })
}
```

## 交互要求

- 按 Escape 关闭。
- 点击外部区域关闭。
- 滚动或窗口 resize 时关闭，除非应用已有锚点重定位能力。
- 支持键盘焦点，并提供清晰可见的 focus 状态。
- 如果菜单会保持打开并支持键盘操作，支持 ArrowUp 和 ArrowDown。
- 菜单不能渲染到视口外。
- 长标签必须省略，不能把菜单撑出视口。
- 破坏性菜单项要可辨识，但不能喧宾夺主。
- 除非明确要求，不要覆盖文本输入区域中的原生编辑菜单。

## 验收清单

完成右键菜单改动前，确认：

- 菜单能在指针位置打开。
- 靠近视口右侧和底部时会正确 clamp。
- 选择可用菜单项后会关闭。
- 禁用菜单项不会触发动作。
- Escape 和外部点击能关闭菜单。
- 亮色和暗色主题都有足够对比度。
- 图标、标签和快捷键在稳定网格中对齐。
- 菜单不会被父容器 overflow 裁剪。
