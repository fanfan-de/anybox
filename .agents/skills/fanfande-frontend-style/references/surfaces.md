# Surfaces

## Surface 层级

使用少量层级即可：

- app background：整体底色
- shell/sidebar surface：导航和结构区
- panel surface：主要内容容器
- muted panel surface：分组或次级内容
- elevated surface：popover、menu、dialog
- overlay：modal 背景

## Panel

panel 是承载内容的结构容器，不是装饰卡片。panel 可使用轻边框、轻 surface、8px 到 12px 圆角。内部使用 section、row、divider、list item，不要再嵌套 card。

## Card

只在重复实体、可点击对象、模板项、插件项、资源项等确实需要对象边界时使用 card。card 半径不超过 8px，阴影默认不用或极轻。管理型列表优先 list/table，而不是卡片网格。

## Popover 与 Dropdown

popover 用 elevated surface、轻边框、轻阴影。宽度按内容决定，短菜单不要继承过宽 min-width。贴边时应有 viewport padding，避免被窗口边缘裁剪。

## Modal/Dialog

dialog 用于阻断性确认、配置、创建、危险操作。标题简短，正文直接，底部 actions 稳定右对齐或符合现有模式。危险操作要有明确语义色和确认边界。

## Drawer

drawer 适合非阻断详情、编辑侧栏、日志详情、插件配置。drawer 内部可滚动，头部和底部操作区固定时要处理内容遮挡。

## Tooltip

tooltip 用于命名 icon button、解释短状态、显示截断内容。不要把复杂帮助文档塞进 tooltip；复杂内容用 popover 或详情面板。
