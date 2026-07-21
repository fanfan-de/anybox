# Long Sessions & Context

An Anybox agent session grows over time. To keep long sessions running, the agent can compact older turns into an internal summary before building the next model request. The summary is sent together with the most recent original messages.

The main implementation lives in `packages/anyboxagent/src/session/core/context-window.ts` and is connected to the run loop in `packages/anyboxagent/src/session/core/prompt.ts`.

## What Context Compaction Solves

A model request cannot carry unlimited history. File reads, terminal output, tool calls, patch summaries, and multi-turn responses all consume the context window. Compaction aims to:

- Preserve goals, decisions, files, errors, tool results, and next steps required to continue the task.
- Keep the most recent turns unchanged so the latest user intent has highest priority.
- Replace older history with a durable summary that can be restored later.
- Trim tool output and summary text if the compacted context is still too large.

## Automatic Compaction

Each agent loop reloads messages from the active branch and prepares the prompt context:

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

Automatic compaction is enabled for normal sessions. Side-chat sessions pass `disableCompaction: true` so their anchor context is not rewritten.

It is also controlled by configuration:

- Automatic compaction is enabled when `config.compaction.auto !== false`.
- `ANYBOX_DISABLE_AUTOCOMPACT` disables automatic compaction.

## Manual Compaction

The desktop app also supports:

- `/compact`
- `~compact`

The Composer intercepts these commands before sending. They are available only in an existing main session and are not stored as ordinary user messages. The renderer calls Electron IPC through `window.desktop.agentSession.compact`, which reaches:

```text
POST /api/sessions/:id/compact
```

The backend reuses `ContextWindow.compactPromptContext` and records the resulting `compaction` part with `auto: false`. If there are not enough older turns, the endpoint returns `status: "noop"` and the Composer shows a lightweight status message.

Manual compaction follows the same safeguards:

- It is unavailable in side chat.
- It cannot run while the session is active.
- The six most recent turns remain uncompressed.

## Context Budget

Before compaction, Anybox calculates a prompt budget from model capabilities:

- Default context limit: `128000` tokens.
- Default output limit: `8192` tokens.
- Reserved output space is clamped between `2048` and `16384` tokens.
- Soft threshold: `72%` of the available prompt budget.
- Hard threshold: `82%` of the available prompt budget.

Compaction begins only after the estimated token count exceeds the soft threshold.

## Choosing What to Compact

Messages are grouped into turns. A turn contains one user message and the assistant messages and tool results that follow it, up to the next user message.

Selection follows these rules:

- Previously compacted history is not resent as original messages.
- Selection continues after the latest `compactedToMessageID` boundary.
- The six most recent turns remain intact by default.
- One batch selects about `12000` tokens at most and never more than `40%` of the prompt budget.
- If an early turn is very large, the oldest eligible turn is still selected.

This makes the summary advance incrementally instead of summarizing the entire conversation on every request.

## Generating the Summary

The model receives existing compacted history together with the newly selected older turns. It is instructed to return only the content inside `<compacted_history>` and preserve:

- Current goals and user requirements.
- Important files, code details, and repository state.
- Completed actions, tool results, and errors.
- Confirmed decisions and their reasons.
- Current progress and next steps.

The current session model is used with `temperature: 0`. When tool definitions are present, they are passed with `toolChoice: "none"` so the model cannot call tools during compaction. A built-in `compaction` subagent also exists with an empty tool policy.

If a compaction request containing tool definitions fails, Anybox retries without the tools. If model compaction fails entirely, it falls back to a shortened transcript excerpt.

## Persistent Format

The compacted result is written back to the session database as an internal user message:

```text
role: user
agent: compaction
internal: true
```

It contains:

- A synthetic `text` part with `metadata.kind: "compacted-history"`, wrapped in `<compacted_history>`.
- A `compaction` part recording `auto`, `compactionID`, message boundaries, `summaryVersion`, and `createdAt`.

The `compaction` part is an internal marker and is not sent to the model or rendered in the normal ThreadView. The `text` part supplies the actual compacted context.

## Rebuilding the Prompt

The next prompt starts with the newest compacted history and appends original turns after the compaction boundary:

```text
system prompts
compacted history internal user message
recent raw user / assistant / tool messages
```

Recent original messages take precedence if they conflict with the summary. System prompts are rebuilt each turn and are not written into `<compacted_history>`.

## Oversized-Context Fallbacks

If the rebuilt prompt still exceeds the hard threshold, Anybox progressively:

1. Trims completed tool output to about `1200` characters.
2. Trims tool output further to about `320` characters.
3. Drops older active turns while keeping at least two turns.
4. Shortens compacted history in `85%` steps while preserving about `1500` characters at minimum.

These changes affect only the context sent to the model and do not delete the original session records.

## Desktop Presentation

The desktop renderer recognizes internal compaction messages and hides their summary text from the normal thread:

- `packages/desktop/src/renderer/src/app/stream.ts` detects `agent: "compaction"` or `type: "compaction"`.
- ThreadView does not render the compacted summary or a compaction marker.
- Results for `/compact` and `~compact` appear as lightweight status near the Composer.

This keeps compaction details out of the previous assistant trace and avoids exposing the full internal summary in ordinary replies.

## Test Coverage

The main tests live in `packages/anyboxagent/Test/session.context-window.test.ts` and verify early-turn compaction, manual `auto: false` records, persistence boundaries, oversized tool-output trimming, model-message filtering, and archive restoration. Frontend restoration and display behavior are covered in `packages/desktop/src/renderer/src/app/stream.test.ts`.
