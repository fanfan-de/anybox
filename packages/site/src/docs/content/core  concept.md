# 长会话与上下文

会话增长后，文件内容、工具输出和历史回复可能超过模型上下文。Anybox 会把较早的完整轮次压缩为内部摘要，并保留最近原始消息，使任务可以继续。

## 自动与手动压缩

自动压缩默认开启，可通过 `config.compaction.auto` 控制；环境变量 `ANYBOX_DISABLE_AUTOCOMPACT` 可将其禁用。

会话空闲时可在输入框使用：

- `/compact`
- `~compact`

命令不会作为普通消息发送。没有足够历史时返回 `status: "noop"`；运行中的会话不能手动压缩。

## 选择与预算

Anybox 按“一个用户消息及其后的回复和工具结果”划分 turn。压缩遵循以下规则：

- 默认保留最近 `6` 个 turn 原文。
- 从最新 `compactedToMessageID` 之后继续选择，不重复压缩历史。
- 单批最多约 `12000` tokens，且不超过 Prompt 预算的 `40%`。
- 默认上下文上限为 `128000` tokens，输出上限为 `8192` tokens。
- 估算超过可用 Prompt 预算的 `72%` 才开始压缩；`82%` 为硬阈值。

具体预算会根据模型能力调整。

## 摘要保留什么

摘要应保留：

- 当前目标、用户要求和已确认决策。
- 重要文件、仓库状态、工具结果与错误。
- 已完成工作、未完成事项和下一步。

摘要使用当前会话模型生成，且禁止在压缩阶段调用工具。失败时会回退为截短的历史摘录。

## 持久化与恢复

结果以内部 user message 写入会话：

```text
role: user
agent: compaction
internal: true
```

其中 `text` part 保存 `<compacted_history>`，`compaction` part 记录 `auto`、`compactionID`、起止消息 ID、版本和时间。下一次 Prompt 的顺序为：

```text
system prompts
compacted history
recent raw messages and tool results
```

若摘要与最近原始消息冲突，以最近消息为准。压缩只改变发送给模型的上下文，不删除原始项目文件。

## 超限与界面展示

若压缩后仍超出硬阈值，运行时会依次缩短已完成的工具输出、丢弃更早的活动轮次（至少保留两个），再缩短摘要。普通 ThreadView 不展示内部摘要；手动压缩结果只在输入框附近显示状态。

主要实现位于 `packages/anyboxagent/src/session/core/context-window.ts`，并由 `prompt.ts` 的运行循环调用。
