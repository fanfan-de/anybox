# 实现检查清单

## 修改前

- 确认所属组件和 CSS 文件。
- 阅读同一 surface 附近的 UI 实现。
- 检查 `appearance-token-manifest.json` 和生成的 runtime token 中是否已有合适语义。
- 按交互职责、状态模型和 ARIA role 确认组件及各子部件所属的 semantic token 组，并列出需要覆盖的完整状态组合。
- 如果正在新增或扩充 token 组，使用 `rg` 盘点同类组件、共享 class、局部变量和旧 token 的全部消费者；确定同次迁移范围或记录明确例外。
- 判断是否需要同步更新项目文档。

## 修改中

- 复用已有组件模式、class 命名和状态命名。
- 组件及其子部件必须使用所属 semantic token 组；局部变量只能一对一映射到该组的 runtime token。
- 复用 shared class 时只继承结构、尺寸、排版和行为，不能继承其他组件的颜色状态。
- 避免硬编码颜色、大阴影、装饰性渐变和新卡片层。
- icon button、row、tab、counter、紧凑控件使用稳定尺寸。
- 长标签可能出现的位置补 `min-width: 0` 和 ellipsis。
- 保留 `focus-visible`、键盘行为、disabled 状态和 aria label。
- 按钮必须检查 default、hover、disabled 在 light/dark 下都来自成组 `--semantic-button-<variant>-*` token，不能直接消费 accent、status、icon 或 text token。
- Field、segmented、switch、dropdown/listbox 和已有独立 product component 同样检查完整状态组合，禁止回退到基础 surface/text、`--seg-*`、`--context-menu-*` 或其他组件组。
- 新增颜色只能进入 manifest 的公开 `literal`/`alias`；确需双来源联动时使用内部 derivation，组件不得新增 `--mix-*` 依赖。
- 组件 CSS 中 `color-mix()` 必须保持为 0；动态品牌色、代码高亮色和 `currentColor` 也不得作为例外。
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
- 在 Appearance 中分别改动该组件组的关键 token 后，对应 default/hover/selected/disabled 等状态确实独立响应，且没有意外影响其他组件类型。

## 验证命令

桌面渲染层改动优先在 `C:/Projects/Anybox/packages/desktop` 下运行：

```powershell
npm run typecheck
npm run test
npm run appearance:tokens:check
```

新增或扩充 semantic token 组时，还要增加：

- 正向断言：代表性组件直接消费或通过一对一局部别名消费对应 runtime token。
- 负向断言：同一组件不再消费基础色、兼容别名、`--context-menu-*` 或其他组件组来表达已经存在的状态。
- 消费者覆盖断言：盘点出的同类组件全部完成迁移，或例外有明确测试和说明。

如果改动跨越 desktop 与 agent server 契约，也检查 `packages/anyboxagent` 相关测试。

明显视觉改动在可行时启动应用或预览，实际检查渲染结果。
