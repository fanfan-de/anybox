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

function toolPart(id, callID, tool, status = "completed") {
  return {
    id,
    type: "tool",
    callID,
    tool,
    state: {
      status,
      input: {},
      raw: "",
      output: `${tool} output`,
    },
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
    "tool.call.completed",
    toolPart("part-1", "call-1", "first_tool"),
  ))
  segments = applyMobileStreamToolEvent(segments, toolEvent(
    "tool.call.completed",
    toolPart("part-2", "call-2", "second_tool"),
  ))

  assert.deepEqual(sourceIDs(segments), ["part-1", "part-2", "part-3"])
}

{
  let segments = []
  segments = appendMessageContentSegment(segments, "response", "hel", "part-3")
  segments = applyMobileStreamToolEvent(segments, toolEvent(
    "tool.call.completed",
    toolPart("part-1", "call-1", "first_tool"),
  ))
  segments = appendMessageContentSegment(segments, "response", "lo", "part-3")

  assert.deepEqual(sourceIDs(segments), ["part-1", "part-3"])
  assert.equal(segments[1].text, "hello")
}

console.log("message merge regression checks passed")
