# Long Sessions & Context

As a session grows, file content, tool output, and replies can exceed the model's context window. Anybox compacts older complete turns into an internal summary while keeping recent messages unchanged so the task can continue.

## Automatic and Manual Compaction

Automatic compaction is enabled by default and controlled by `config.compaction.auto`. Set `ANYBOX_DISABLE_AUTOCOMPACT` to disable it.

When a session is idle, enter either command in the Composer:

- `/compact`
- `~compact`

The command is not sent as a normal message. It returns `status: "noop"` when there is not enough history, and it cannot run while the session is active.

## Selection and Budget

Anybox defines a turn as one user message plus the replies and tool results that follow it. Compaction follows these rules:

- Keep the latest `6` turns unchanged by default.
- Continue after the newest `compactedToMessageID` instead of compacting the same history again.
- Select at most about `12000` tokens per batch and no more than `40%` of the prompt budget.
- Use default limits of `128000` context tokens and `8192` output tokens.
- Begin at `72%` of the available prompt budget; treat `82%` as the hard threshold.

Actual budgets adjust to the selected model's capabilities.

## What the Summary Preserves

The summary retains:

- Current goals, user requirements, and confirmed decisions.
- Important files, repository state, tool results, and errors.
- Completed work, unfinished items, and next steps.

It uses the current session model with tool calls disabled. If model-based compaction fails, Anybox falls back to a shortened transcript excerpt.

## Persistence and Recovery

The result is stored as an internal user message:

```text
role: user
agent: compaction
internal: true
```

Its `text` part contains `<compacted_history>`. Its `compaction` part records `auto`, `compactionID`, message boundaries, version, and time. The next prompt is rebuilt in this order:

```text
system prompts
compacted history
recent raw messages and tool results
```

Recent raw messages win if they conflict with the summary. Compaction changes only the context sent to the model; it does not delete project files.

## Fallbacks and Presentation

If the rebuilt prompt still exceeds the hard threshold, the runtime progressively trims completed tool output, drops older active turns while retaining at least two, and then shortens the summary. ThreadView hides internal summaries; manual compaction reports status near the Composer.

The main implementation is `packages/anyboxagent/src/session/core/context-window.ts`, called from the run loop in `prompt.ts`.
