# 标准滚动条

本参考用于页面右侧主滚动条、主内容区、侧栏和长列表容器。短右键菜单、短下拉菜单、命令菜单和紧凑浮层继续遵守 `SKILL.md` 中的规则：默认不显示、不预留滚动条槽位。

## 视觉标准

- 参考样式是截图中页面右侧的浅色窄滚动条：整体安静、贴边、低对比，只表达当前位置，不成为装饰元素。
- 轨道透明或与页面背景一致，不加边框、底色条、阴影、渐变或彩色状态。
- 滑块使用中性灰，视觉宽度约 5px 到 6px，圆角为胶囊形；默认颜色轻，hover/active 才加深。
- 滚动条总占位可为 10px 到 12px，通过透明边框让真实滑块显得更细，避免贴边太粗。
- 暗色主题使用同样的低对比逻辑：透明轨道，浅灰半透明滑块，不使用高亮品牌色。
- 页面级和长内容容器可以显示滚动条；紧凑弹层、短菜单、按钮下拉菜单不套用这个可见滚动条模板。

## Token 建议

优先映射到项目已有 token。没有现成 token 时，可用以下语义变量作为默认值：

```css
:root {
  --ui-scrollbar-size: 10px;
  --ui-scrollbar-thumb: rgba(0, 0, 0, 0.22);
  --ui-scrollbar-thumb-hover: rgba(0, 0, 0, 0.32);
  --ui-scrollbar-thumb-active: rgba(0, 0, 0, 0.42);
  --ui-scrollbar-track: transparent;
}

[data-theme="dark"] {
  --ui-scrollbar-thumb: rgba(255, 255, 255, 0.24);
  --ui-scrollbar-thumb-hover: rgba(255, 255, 255, 0.34);
  --ui-scrollbar-thumb-active: rgba(255, 255, 255, 0.46);
}
```

## CSS 模板

把 `.ui-scrollbar` 加到页面主滚动容器、长列表、侧栏等确实需要可见滚动条的元素上。全局页面滚动条可将选择器替换为 `html` 或 `body`，但不要把它强行应用到所有弹层菜单。

```css
.ui-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scrollbar-thumb) var(--ui-scrollbar-track);
}

.ui-scrollbar::-webkit-scrollbar {
  width: var(--ui-scrollbar-size);
  height: var(--ui-scrollbar-size);
}

.ui-scrollbar::-webkit-scrollbar-track {
  background: var(--ui-scrollbar-track);
}

.ui-scrollbar::-webkit-scrollbar-thumb {
  min-height: 32px;
  background-color: var(--ui-scrollbar-thumb);
  background-clip: content-box;
  border: 3px solid transparent;
  border-radius: 999px;
}

.ui-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: var(--ui-scrollbar-thumb-hover);
}

.ui-scrollbar::-webkit-scrollbar-thumb:active {
  background-color: var(--ui-scrollbar-thumb-active);
}

.ui-scrollbar::-webkit-scrollbar-corner {
  background: transparent;
}
```

## 使用检查

- 如果容器高度不稳定，先固定滚动区域边界，再加滚动条样式。
- 如果滚动条挤压内容导致布局抖动，优先修正容器宽度或内边距；只有页面级布局确实需要稳定占位时才使用 `scrollbar-gutter: stable`。
- 如果项目已有浏览器兼容封装、Tailwind 插件或组件库 scrollbar token，复用现有入口，只替换成这里的视觉参数。
