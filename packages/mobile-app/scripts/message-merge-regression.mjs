import assert from "node:assert/strict"
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.resolve(scriptDir, "../src/utils/message.ts")
const source = fs.readFileSync(sourcePath, "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const module = { exports: {} }

new Function("exports", "require", "module", compiled)(module.exports, require, module)

const {
  appendMessageContentSegment,
  applyMobileStreamToolEvent,
  mergeActiveStreamMessages,
  messageRole,
  messageText,
} = module.exports

function message(id, role, text, created) {
  return {
    info: {
      id,
      role,
      created,
      updated: created,
    },
    parts: [{ type: "text", text }],
  }
}

function activeStream(overrides = {}) {
  return {
    sessionID: "s1",
    anchorMessageID: "m1",
    createdAt: 10,
    updatedAt: 20,
    status: "streaming",
    prompt: {
      id: "local-1",
      text: "repeat me",
    },
    assistant: {
      id: "stream-1",
      segments: [{ kind: "response", text: "local answer" }],
    },
    ...overrides,
  }
}

function ids(messages) {
  return messages.map((item) => item.info.id)
}

function sourceIDs(segments) {
  return segments.map((segment) => segment.sourceID)
}

function toolEvent(type, part) {
  return {
    event: "runtime",
    data: {
      type,
      payload: {
        part,
      },
    },
  }
}

function toolPart(id, callID, tool, overrides = {}) {
  const outcome = overrides.outcome ?? {
    kind: "returned",
    result: "success",
    completeness: "complete",
    output: `${tool} output`,
    execution: { sideEffect: "none", retry: "safe" },
  }
  const revision = overrides.revision ?? 1
  return {
    id,
    type: "tool",
    schemaVersion: 3,
    sessionID: "s1",
    turnID: "turn-1",
    messageID: "message-1",
    callID,
    tool,
    input: { raw: "", value: {} },
    source: { kind: "model" },
    retry: { attempt: 1 },
    revision,
    timestamps: { createdAt: 10, settledAt: 10 + revision },
    state: { phase: "settled", outcome, control: { mode: "continue-model" } },
  }
}

{
  const result = mergeActiveStreamMessages([
    message("m1", "assistant", "old", 1),
    message("m2", "user", "repeat me", 2),
    message("m3", "assistant", "server answer", 3),
  ], activeStream())

  assert.deepEqual(ids(result), ["m1", "m2", "stream-1"])
  assert.equal(result.filter((item) => messageRole(item) === "assistant").length, 2)
  assert.equal(messageText(result[2]), "local answer")
}

{
  const result = mergeActiveStreamMessages([
    message("m1", "assistant", "old", 1),
  ], activeStream())

  assert.deepEqual(ids(result), ["m1", "local-1", "stream-1"])
}

{
  const result = mergeActiveStreamMessages([
    message("m1", "assistant", "old", 1),
    message("m2", "user", "repeat me", 2),
    message("m4", "user", "next turn", 4),
  ], activeStream())

  assert.deepEqual(ids(result), ["m1", "m2", "stream-1", "m4"])
}

{
  const result = mergeActiveStreamMessages([
    message("old-repeat", "assistant", "local answer", 0),
    message("m1", "assistant", "old", 1),
  ], activeStream())

  assert.deepEqual(ids(result), ["old-repeat", "m1", "local-1", "stream-1"])
}

{
  let segments = []
  segments = appendMessageContentSegment(segments, "response", "final", "part-3")
  segments = applyMobileStreamToolEvent(segments, toolEvent(
    "tool.call.settled",
    toolPart("part-1", "call-1", "first_tool"),
  ))
  segments = applyMobileStreamToolEvent(segments, toolEvent(
    "tool.call.settled",
    toolPart("part-2", "call-2", "second_tool"),
  ))

  assert.deepEqual(sourceIDs(segments), ["part-1", "part-2", "part-3"])
}

{
  let segments = []
  segments = appendMessageContentSegment(segments, "response", "hel", "part-3")
  segments = applyMobileStreamToolEvent(segments, toolEvent(
    "tool.call.settled",
    toolPart("part-1", "call-1", "first_tool"),
  ))
  segments = appendMessageContentSegment(segments, "response", "lo", "part-3")

  assert.deepEqual(sourceIDs(segments), ["part-1", "part-3"])
  assert.equal(segments[1].text, "hello")
}

{
  const negativePartial = {
    kind: "returned",
    result: "negative",
    completeness: "partial",
    output: { exitCode: 1, stderr: "lint failed" },
    execution: { sideEffect: "possible", retry: "unknown" },
  }
  let segments = applyMobileStreamToolEvent([], toolEvent(
    "tool.call.settled",
    toolPart("part-1", "call-1", "exec", { outcome: negativePartial, revision: 4 }),
  ))
  segments = applyMobileStreamToolEvent(segments, toolEvent(
    "tool.call.created",
    toolPart("part-1", "call-1", "exec", { revision: 2 }),
  ))

  assert.equal(segments[0].call.revision, 4)
  assert.equal(segments[0].call.state.outcome.result, "negative")
  assert.equal(segments[0].call.state.outcome.completeness, "partial")
}

console.log("message merge regression checks passed")
