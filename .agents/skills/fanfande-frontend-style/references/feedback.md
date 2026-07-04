# Feedback

## Toast

toast 用于短暂反馈：保存成功、复制成功、任务失败、后台任务开始。不要用 toast 承载必须阅读的长说明。错误 toast 要提供下一步或打开详情入口。

## Banner

banner 用于页面级状态：离线、权限不足、配置缺失、版本更新、任务阻塞。banner 需要清晰 severity 和行动按钮。

## Loading

加载状态要匹配区域：

- button 内部动作：按钮 loading。
- 局部列表：row skeleton 或 inline spinner。
- 整页初始化：页面 skeleton。
- 长任务：progress、step list 或日志。

不要用全屏 spinner 掩盖局部加载。

## Skeleton

skeleton 应接近最终布局，避免加载完成后大幅跳动。密集列表用行 skeleton，卡片列表用卡片 skeleton。

## Empty State

空状态说明当前为什么为空，并给出一个直接下一步。不要做营销式大插画。工作台空状态可以更轻，配置页空状态更直接。

## Error Recovery

错误状态要包含：发生了什么、影响范围、用户能做什么。开发/调试页面可以显示技术详情，但默认折叠。

## Progress

长任务显示当前阶段、总进度或不可确定状态。允许取消时必须显示取消入口，并说明取消后状态。
