import { describe, expect, test } from "bun:test"
import type * as Config from "../src/config/config.ts"
import type { McpToolDefinition } from "../src/mcp/client.ts"
import {
  assessComputerUsePermission,
  describeComputerUseApproval,
} from "../src/mcp/computer-use/permission-advisor.ts"

const server = {
  id: "anybox.computer-use",
  name: "Computer Use",
  enabled: true,
  transport: "stdio",
  command: "__anybox_in_process__",
  owner: {
    kind: "anybox",
    bindingID: "computer-use",
  },
} satisfies Config.McpServerSummary

function tool(name: string): McpToolDefinition {
  return {
    name,
    title: name.replaceAll("_", " "),
    inputSchema: { type: "object" },
  }
}

describe("Computer Use permission advisor", () => {
  test("allows only read-only discovery without action approval", () => {
    expect(assessComputerUsePermission({
      server,
      tool: tool("get_window_state"),
      args: { includeScreenshot: true },
    })).toMatchObject({
      action: "allow",
      risk: "low",
    })
  })

  test("honors stricter user tool policy without weakening host policy", () => {
    expect(assessComputerUsePermission({
      server,
      tool: tool("get_window_state"),
      args: {},
      configuredPolicy: "ask",
    })).toMatchObject({
      action: "ask",
      risk: "low",
      forceAsk: true,
    })
    expect(assessComputerUsePermission({
      server,
      tool: tool("click"),
      args: { safety: "normal", purpose: "click a control" },
      configuredPolicy: "disabled",
    })).toMatchObject({
      action: "deny",
      risk: "high",
    })
    expect(assessComputerUsePermission({
      server,
      tool: tool("click"),
      args: { safety: "normal", purpose: "click a control" },
      configuredPolicy: "auto",
    })).toMatchObject({
      action: "ask",
      forceAsk: true,
    })
  })

  test("hard-denies secret, finance, and security-setting categories", () => {
    for (const safety of ["auth_or_secret", "finance", "security_settings"]) {
      expect(assessComputerUsePermission({
        server,
        tool: tool("click"),
        args: {
          safety,
          purpose: "The model claims this is harmless.",
        },
      })).toMatchObject({
        action: "deny",
        risk: "critical",
      })
    }
  })

  test("normal cannot lower delete, send, upload, or install intent", () => {
    for (const purpose of [
      "delete the selected file",
      "send this message",
      "上传当前文档",
      "安装这个应用",
    ]) {
      expect(assessComputerUsePermission({
        server,
        tool: tool("click"),
        args: { safety: "normal", purpose },
      })).toMatchObject({
        action: "ask",
        risk: "high",
        forceAsk: true,
      })
    }
  })

  test("always requires action approval and redacts typed content", () => {
    const secret = "do-not-log-this-private-value"
    const intent = assessComputerUsePermission({
      server,
      tool: tool("type_text"),
      args: {
        safety: "normal",
        purpose: "Fill a draft field",
        text: secret,
      },
    })
    expect(intent).toMatchObject({
      action: "ask",
      risk: "medium",
      forceAsk: true,
    })
    expect(intent?.resource?.body).not.toContain(secret)
    expect(intent?.resource?.body).toContain(`<redacted ${secret.length} characters>`)

    const approval = describeComputerUseApproval({
      server,
      tool: tool("type_text"),
      args: {
        safety: "normal",
        purpose: "Fill a draft field",
        text: secret,
      },
    })
    expect(approval?.details?.body).not.toContain(secret)

    const valueApproval = describeComputerUseApproval({
      server,
      tool: tool("set_value"),
      args: {
        safety: "normal",
        purpose: "Update a draft field",
        value: secret,
      },
    })
    expect(valueApproval?.details?.body).not.toContain(secret)
    expect(valueApproval?.details?.body).toContain(`<redacted ${secret.length} characters>`)
  })

  test("does not claim third-party servers with the same display name", () => {
    const thirdParty = {
      ...server,
      id: "plugin.fake.computer-use",
      owner: {
        kind: "plugin" as const,
        pluginID: "fake",
        bindingID: "windows",
      },
    }
    expect(assessComputerUsePermission({
      server: thirdParty,
      tool: tool("click"),
      args: { safety: "normal", purpose: "click" },
    })).toBeUndefined()
  })
})
