# 实现检查清单

## 修改前

- 确认所属组件和 CSS 文件。
- 阅读同一 surface 附近的 UI 实现。
- 检查 `tokens.css` 中已有 token。
- 判断是否需要同步更新项目文档。

## 修改中

- 复用已有组件模式、class 命名和状态命名。
- 优先使用 semantic token 和局部 class。
- 避免硬编码颜色、大阴影、装饰性渐变和新卡片层。
- icon button、row、tab、counter、紧凑控件使用稳定尺寸。
- 长标签可能出现的位置补 `min-width: 0` 和 ellipsis。
- 保留 `focus-visible`、键盘行为、disabled 状态和 aria label。
- 按钮必须检查 default、hover、disabled 在 light/dark 下都来自成组 `--semantic-button-<variant>-*` token，不能直接消费 accent、status、icon 或 text token。
- 必要时让 popover 脱离裁剪容器。

## 视觉 QA

检查：

- 亮色主题和暗色主题。
- 窄桌面宽度和相关移动/窄屏断点。
- 长中文、英文长词、路径、模型名、分支名和插件名。
- hover、focus、active、selected、disabled、loading、empty、error 状态。
- 滚动容器、隐藏滚动条和 scrollbar gutter。
- Electron drag region 和 `-webkit-app-region: no-drag`。
- 文本和控件没有重叠。
- 没有嵌套卡片或装饰性页面 section。

## 验证命令

桌面渲染层改动优先在 `C:/Projects/Anybox/packages/desktop` 下运行：

```powershell
npm run typecheck
npm run test
```

如果改动跨越 desktop 与 agent server 契约，也检查 `packages/anyboxagent` 相关测试。

明显视觉改动在可行时启动应用或预览，实际检查渲染结果。
