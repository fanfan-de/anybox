# 核心概念

Anybox Agent 的会话历史会持续增长。为了让长会话继续运行，Agent 在构建下一次模型请求前，会把较早的对话轮次压缩成一条内部摘要消息，再把这条摘要和最近的原始消息一起发送给模型。

这个机制主要由 `packages/anyboxagent/src/session/core/context-window.ts` 实现，并在 `packages/anyboxagent/src/session/core/prompt.ts` 的 run loop 中接入。

## 上下文压缩解决什么问题

模型请求不能无限携带完整历史。文件阅读结果、终端输出、工具调用、补丁摘要和多轮回复都会占用上下文窗口。压缩机制的目标是：

- 保留继续任务需要的目标、决策、文件、错误、工具结果和下一步。
- 保留最近几轮原始消息，让最新用户意图仍然有最高优先级。
- 把较早历史替换为可持久化、可恢复的摘要消息。
- 在摘要仍然过大时，继续裁剪工具输出和摘要正文，避免模型请求超过预算。

## 触发入口

每轮 Agent 循环都会重新从数据库读取当前 active branch 的消息，然后调用：

```ts
ContextWindow.preparePromptContext({
  sessionID,
  model,
  system,
  messages,
  reasoningEffort,
  tools,
  recordCompactionMessage,
  disableCompaction: Session.isSideChatSession(activeSession),
})
```

普通会话默认启用自动压缩。侧聊会话会传入 `disableCompaction: true`，避免 side chat 的锚点上下文被改写。

自动压缩还受项目配置和环境标记控制：

- `config.compaction.auto !== false` 时启用自动压缩。
- `ANYBOX_DISABLE_AUTOCOMPACT` 打开时禁用自动压缩。

## 手动压缩入口

桌面端还提供主动压缩命令：

- `/compact`
- `~compact`

这两个命令由 Composer 在发送前拦截，只在已有主会话中启用，不会作为普通用户消息发给模型。拦截后 renderer 通过 `window.desktop.agentSession.compact` 进入 Electron IPC，再调用后端：

```text
POST /api/sessions/:id/compact
```

后端用例会复用 `ContextWindow.compactPromptContext` 强制执行一次压缩，并把 `compaction` part 的 `auto` 标记写为 `false`。如果当前会话还没有足够早期 turns 可压缩，接口返回 `status: "noop"`，前端只在 Composer 附近展示轻量状态提示，不写入新的历史消息，也不进入 ThreadView。

手动压缩同样遵守以下保护：

- side chat 不允许手动压缩，避免改写锚点上下文。
- 会话正在运行时不允许压缩，避免和当前 prompt 构建竞争。
- 最近 `6` 个 turns 仍保留为原始消息，命令只压缩更早的完整 turns。

## 上下文预算

压缩前先根据模型能力计算 prompt 预算：

- 默认 context limit 是 `128000` tokens。
- 默认 output limit 是 `8192` tokens。
- 预留输出空间会限制在 `2048` 到 `16384` tokens 之间。
- soft threshold 是可用 prompt 预算的 `72%`。
- hard threshold 是可用 prompt 预算的 `82%`。

当估算 tokens 小于 soft threshold 时，直接使用当前窗口。超过 soft threshold 后，才开始选择较早轮次做压缩。

## 压缩范围选择

消息会先按 user message 切成 turn。一次 turn 包含一条用户消息，以及它之后直到下一条用户消息前的 assistant 消息和工具结果。

选择压缩范围时遵守这些规则：

- 已经被压缩过的历史不会重复作为原始消息发送。
- 从最新 compaction 的 `compactedToMessageID` 之后继续计算可压缩轮次。
- 默认保留最近 `6` 个 turn 不压缩。
- 单次压缩批次最多选择约 `12000` tokens，且不会超过 prompt 预算的 `40%`。
- 如果早期 turn 太大，至少会选择最早的一个可压缩 turn。

这样可以让摘要逐步向前滚动，而不是每次都重新总结整段会话。

## 摘要生成

压缩时会把已有 compacted history 和本次选中的早期 turns 一起交给模型总结。追加给模型的压缩指令要求它只返回 `<compacted_history>` 标签内部的内容，并保留：

- 当前任务目标和用户要求。
- 重要文件、代码细节和仓库状态。
- 已经做过的操作、工具结果和错误。
- 已确认的设计决策及原因。
- 当前进度和下一步。

生成摘要时使用当前会话模型，`temperature` 为 `0`。如果当前请求带有工具定义，压缩调用会传入工具但设置 `toolChoice: "none"`，防止模型在压缩阶段发起工具调用。仓库里也注册了内置 `compaction` agent，类型是 `subagent`，工具策略为空。

如果带工具定义的压缩请求失败，会自动重试一次不带工具的请求。如果模型压缩整体失败，则回退到 fallback summary：把可渲染的消息摘要截取为一段继续任务用的 transcript excerpt。

## 持久化格式

压缩结果不是只存在内存里，而是写回会话数据库。它表现为一条内部 user message：

```text
role: user
agent: compaction
internal: true
```

这条消息包含两个关键 part：

- `text` part：`synthetic: true`，`metadata.kind: "compacted-history"`，正文用 `<compacted_history>...</compacted_history>` 包裹。
- `compaction` part：记录 `auto`、`compactionID`、`compactedFromMessageID`、`compactedToMessageID`、`summaryVersion` 和 `createdAt`。

`compaction` part 只作为内部标记使用，不会发送给模型，也不会进入普通 ThreadView。真正进入模型上下文的是 `text` part 里的 compacted history。

## 重建 Prompt

下一轮构建 prompt 时，会读取最新的 compacted history，把它放在消息列表最前面，然后追加压缩边界之后的原始 turns：

```text
system prompts
compacted history internal user message
recent raw user / assistant / tool messages
```

如果摘要和最近原始消息冲突，最近原始消息更权威。系统提示不会被写进 `<compacted_history>`，而是每轮重新构建。

## 过大窗口的兜底策略

如果构建后的 prompt 仍然超过 hard threshold，会按顺序降级：

1. 把已完成工具输出裁剪到约 `1200` 字符。
2. 仍然过大时，把工具输出进一步裁剪到约 `320` 字符。
3. 允许丢弃更早的 active turns，但至少保留 `2` 个 turn。
4. 如果 compacted history 本身过大，按 `85%` 逐步缩短，最低保留约 `1500` 字符。

这些裁剪只影响发送给模型的上下文窗口，不等同于删除原始会话记录。

## 前端展示

桌面端不会把 compacted summary 正文直接暴露在普通线程里。渲染层会识别内部 compaction message，并在构建 ThreadView 消息时过滤掉它：

- `packages/desktop/src/renderer/src/app/stream.ts` 识别 `agent: "compaction"` 或 `type: "compaction"`。
- ThreadView 不展示 compacted summary，也不展示压缩状态 marker。
- `/compact` 和 `~compact` 的成功、失败、noop 结果由 Composer 附近的轻量状态提示展示。

这样压缩状态不会混入上一轮 assistant trace，同时也不会在普通回复里泄漏完整摘要正文。

## 测试覆盖

当前测试主要在 `packages/anyboxagent/Test/session.context-window.test.ts`：

- 验证早期 turns 会压缩成内部 user message。
- 验证手动压缩会写入 `auto: false` 的 `compaction` part。
- 验证 persisted history 再次读取时，会从 compacted boundary 后继续保留原始消息。
- 验证过大的工具输出会被裁剪。
- 验证 `compaction` part 不会发送给模型。
- 验证归档和恢复会保留 compacted history。

相关前端恢复和展示逻辑在 `packages/desktop/src/renderer/src/app/stream.test.ts` 中覆盖。
