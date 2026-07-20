"use strict"

const { SAFETY_VALUES } = require("./policy")

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }
}

function actionSchema(properties, required = []) {
  return objectSchema({
    ...properties,
    purpose: {
      type: "string",
      minLength: 1,
      description: "Short reason for this desktop action.",
    },
    safety: {
      type: "string",
      enum: SAFETY_VALUES,
      description: "Intent hint only. Host and helper policy may raise or reject the action.",
    },
  }, required)
}

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "computer_health_check",
    title: "Computer Use Health Check",
    description: "Report helper, protocol, capture, accessibility, and input compatibility.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "list_apps",
    title: "List Apps",
    description: "List the bounded Windows application catalog. Paths and command lines are never returned.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "list_windows",
    title: "List Windows",
    description: "List visible controllable Windows desktop windows without capturing them.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "get_window",
    title: "Get Window",
    description: "Resolve one window by opaque reference or an unambiguous discovery query.",
    inputSchema: objectSchema({
      windowRef: { type: "string", description: "A windowRef returned by list_windows." },
      titleQuery: { type: "string", description: "Case-insensitive title substring for discovery only." },
      processName: { type: "string", description: "Process executable name for discovery only." },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "get_window_state",
    title: "Get Window State",
    description: "Capture a fresh, short-lived screenshot and accessibility observation.",
    inputSchema: objectSchema({
      windowRef: { type: "string", description: "A windowRef returned by list_windows or get_window." },
      includeScreenshot: { type: "boolean", description: "Include a PNG screenshot. Defaults to true." },
      includeAccessibility: { type: "boolean", description: "Include a bounded UI Automation snapshot. Defaults to true." },
      includeDocumentText: { type: "boolean", description: "Include bounded document text when supported. Defaults to false." },
    }, ["windowRef"]),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "launch_app",
    title: "Launch App",
    description: "Launch exactly one current catalog entry by appRef or appId. Paths, arguments, URLs, and commands are not accepted.",
    inputSchema: actionSchema({
      appRef: { type: "string", description: "An opaque appRef returned by list_apps." },
      appId: { type: "string", description: "A stable appId returned by list_apps." },
    }, ["purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "activate_window",
    title: "Activate Window",
    description: "Bring the selected window to the foreground after approval.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
    }, ["windowRef", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "click",
    title: "Click",
    description: "Click one UI Automation element or screenshot point from a fresh state. Exactly one target mode is allowed.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      stateRef: { type: "string" },
      elementIndex: { type: "integer", minimum: 0, description: "Element index from this state's accessibility tree." },
      screenshotId: { type: "string", description: "Screenshot ID for coordinate mode." },
      x: { type: "number", description: "Screenshot-local X coordinate for coordinate mode." },
      y: { type: "number", description: "Screenshot-local Y coordinate for coordinate mode." },
      button: { type: "string", enum: ["left", "right"] },
      clickCount: { type: "integer", minimum: 1, maximum: 2 },
    }, ["windowRef", "stateRef", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "scroll",
    title: "Scroll",
    description: "Scroll one UI Automation element or screenshot point from a fresh state. Exactly one target mode is allowed.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      stateRef: { type: "string" },
      elementIndex: { type: "integer", minimum: 0, description: "Element index from this state's accessibility tree." },
      screenshotId: { type: "string", description: "Screenshot ID for coordinate mode." },
      x: { type: "number", description: "Screenshot-local X coordinate for coordinate mode." },
      y: { type: "number", description: "Screenshot-local Y coordinate for coordinate mode." },
      deltaX: { type: "number" },
      deltaY: { type: "number" },
    }, ["windowRef", "stateRef", "deltaY", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "press_key",
    title: "Press Key",
    description: "Press an allowlisted key chord in the selected window from a fresh state.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      stateRef: { type: "string" },
      keys: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
    }, ["windowRef", "stateRef", "keys", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "type_text",
    title: "Type Text",
    description: "Type bounded text into the focused target from a fresh state.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      stateRef: { type: "string" },
      text: { type: "string", maxLength: 32768 },
    }, ["windowRef", "stateRef", "text", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "set_value",
    title: "Set Value",
    description: "Set one non-password UI Automation value from a fresh state using ValuePattern or RangeValuePattern.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      stateRef: { type: "string" },
      elementIndex: { type: "integer", minimum: 0 },
      value: { type: "string", maxLength: 32768 },
    }, ["windowRef", "stateRef", "elementIndex", "value", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "perform_secondary_action",
    title: "Perform Secondary Action",
    description: "Perform an allowlisted action that was explicitly reported for a fresh UI Automation element.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      stateRef: { type: "string" },
      elementIndex: { type: "integer", minimum: 0 },
      action: { type: "string", enum: ["toggle", "select", "expand", "collapse"] },
    }, ["windowRef", "stateRef", "elementIndex", "action", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "drag",
    title: "Drag",
    description: "Drag between two points from a fresh state. The state is consumed after this action.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      stateRef: { type: "string" },
      screenshotId: { type: "string" },
      fromX: { type: "number" },
      fromY: { type: "number" },
      toX: { type: "number" },
      toY: { type: "number" },
    }, ["windowRef", "stateRef", "screenshotId", "fromX", "fromY", "toX", "toY", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
])

module.exports = {
  TOOL_DEFINITIONS,
  actionSchema,
  objectSchema,
}
