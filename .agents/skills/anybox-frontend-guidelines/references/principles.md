# 总体原则

## 产品气质

把 Anybox 做成安静、成熟、克制的桌面生产力工具。优先考虑工作流、信息层级、扫描效率和重复操作效率，而不是装饰表达。

整体可以参考 Obsidian-like 的桌面气质：低装饰、面板化、弱强调色、接近原生窗口体验，并兼顾鼠标和键盘效率。不要把产品工具界面做成营销落地页、hero page 或装饰型 dashboard。

## 信息层级

- 先展示当前任务最重要的内容，辅助元信息不要抢主要内容的视觉焦点。
- 优先使用紧凑 rows、lists、panes、tabs、toolbars，而不是大卡片。
- 标题尺寸要匹配容器。pane、设置行、侧边栏、表格、工具面板里不要使用 hero 级大标题。
- 默认不常驻解释性 helper text，除非它会影响用户决策，例如错误原因、危险后果、权限影响、不可逆变更、异步任务恢复、空状态下一步。
- 列表、表格、设置、侧边栏行默认只展示一行主内容。辅助信息放到独立列、tooltip、详情面板、展开行或 hover/focus 浮层。

## 视觉克制

- 卡片只用于重复项目、模态框和确实需要框住的工具。不要嵌套装饰性卡片。
- 不要添加装饰性渐变、光斑、玻璃拟态、厚重阴影、大面积品牌色背景或单一色系铺满的视觉。
- 优先使用轻量 surface、细分隔线、稳定间距和语义状态色。
- 常见状态优先用 icon、dot、spinner、progress 或位置表达，再考虑文字 badge。

## 交互标准

- 操作使用真实 `<button>`，并保留 `:focus-visible`。
- 常见工具栏动作优先使用纯 icon button，并提供 `aria-label`、`title` 或 tooltip。明确命令使用纯文本按钮。
- 新增按钮默认不要混用 icon 和文字，除非同一区域已有稳定的本地模式。
- 有合适图标时优先使用 lucide 图标。
- hover/active 状态必须保持布局稳定，不使用 translate、scale、尺寸变化或阴影抬升。
- 输入框、textarea、contenteditable 和 webview 默认保留原生编辑右键菜单，除非产品明确接管该区域。

## 文本和布局韧性

- 需要截断的 flex/grid 子项必须设置 `min-width: 0`。
- toolbar、icon button、row、counter、tab、紧凑控件使用稳定尺寸。
- 对长中文、英文长词、路径、模型名、分支名使用明确的省略或换行策略，不能与相邻控件重叠。
- 除既有微型 uppercase label 外，letter spacing 保持 `0`。
