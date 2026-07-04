# Token 规则

## 优先级

1. 优先使用项目已有 token。
2. 优先使用语义 token，而不是基础色值。
3. 优先使用本地组件已有变量，而不是跨组件硬套。
4. 只有缺少语义表达时才新增 token。

当前项目常见 token 家族：

- 字体：`--font-sans`、`--font-mono`
- 间距：`--space-*`
- 圆角：`--radius-control`、`--radius-chip`、`--radius-panel`、`--radius-overlay`
- 基础表面：`--surface-*`
- 文本：`--text-primary`、`--text-secondary`、`--text-tertiary`
- 边框：`--border-subtle`、`--border-default`
- 品牌：`--brand-primary`、`--brand-primary-hover`、`--brand-accent-highlight`
- 语义：`--semantic-success-*`、`--semantic-warning-*`、`--semantic-error-*`、`--semantic-info-*`
- 兼容/分段：`--seg-*`
- 预混合：`--mix-*`

## 色彩

主界面以 warm neutral surface 为基础。品牌色偏 terra/coral，用于按钮、选中、链接、关键状态和 focus 辅助，不用于大面积背景。

避免新增蓝紫渐变、纯灰冷色 dashboard、单一紫色主题或大面积高饱和色块。状态色必须走语义 token，不要直接写红、绿、黄。

## 圆角

- 小控件：`4px` 到 `6px`
- chip、badge、tab：`6px` 到 `8px`
- panel、popover：`8px` 到 `12px`
- 窗口级容器可以更大，但普通页面不要滥用大圆角
- pill 只用于 badge、toggle track 或确实需要胶囊语义的元素

## 阴影

默认使用边框和 surface 区分层级。只有浮层、dialog、popover、context menu、drag preview 需要阴影。阴影要轻，不要做卡片墙式厚重阴影。

## 动效

使用 `--motion-fast`、`--motion-base`、`--motion-slow`。动效只服务状态变化、浮层出现、拖拽反馈和 hover 反馈。不要添加无意义循环动画。

## 新增 token 规则

新增 token 时命名要表达语义位置，而不是颜色本身。例如用 `--semantic-command-menu-surface`，不要用 `--pink-light-bg`。新增后检查 light/dark 两套主题和 `data-brand-theme` 覆盖。
