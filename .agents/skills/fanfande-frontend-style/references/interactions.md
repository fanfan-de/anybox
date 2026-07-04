# Interactions

## Hover

hover 只表达可交互性，不应造成布局移动。图标颜色、轻背景、边框变化足够。不要使用夸张 transform。

## Focus

所有可键盘操作元素必须有 `:focus-visible`。focus ring 使用项目 token，例如 `--focus-outline-color`。不要移除 outline 后没有替代方案。

## Keyboard

菜单、dialog、tabs、tree、listbox、combobox 要支持常见键盘路径：Tab、Shift+Tab、Enter、Space、Esc、Arrow keys。关闭浮层后焦点应回到触发元素。

## Selection

selected、active、checked、expanded 是不同状态。selected 表示当前选择项；active 表示按下或当前激活交互；checked 表示表单值；expanded 表示展开。

## Drag And Drop

拖拽需要明确 drag handle、drop target、preview、禁止状态和取消路径。drop preview 不应遮挡关键内容。拖拽时避免整个布局跳动。

## Resize

可 resize 区域需要明确 handle 和尺寸边界。拖动中要给反馈，释放后保存尺寸时要处理失败回退。

## Shortcut

快捷键只展示用户可用的稳定操作。冲突或不可用时不要显示误导性 shortcut。菜单中 shortcut 使用固定右侧槽位。

## Pointer 与 Touch

Electron 桌面以鼠标键盘优先，但控件点击区域仍应足够。icon button 视觉可小，实际 hit area 不要太小。
