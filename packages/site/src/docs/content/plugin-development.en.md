# Build Plugins

An Anybox plugin can combine Skills, MCP tools, and connectors. New plugins use `.anybox-plugin/plugin.json`; root `plugin.json` and `.codex-plugin/plugin.json` are compatibility inputs only.

> Do not use the old `.fanfande-plugin/plugin.json` or `plugin.meta.json`, and do not place generated ZIP files inside expanded source packages.

## Choose a Capability

| Capability | Purpose | Manifest field |
| --- | --- | --- |
| Skill | Workflows, domain knowledge, and rules | `skills` |
| MCP server | Executable local or remote tools | `mcpServers` |
| Connector | Plugin-specific API key or OAuth | `connectors` |
| Connector requirement | Reuse an existing platform connection | `connectorRequirements` |

Start with a Skill when the plugin only guides the agent. Add MCP or a connector when it must execute code or exchange external data.

## Minimal Skill Plugin

Create this structure:

```text
anybox-plugins/
  hello-anybox/
    .anybox-plugin/
      plugin.json
    skills/
      hello/
        SKILL.md
```

`.anybox-plugin/plugin.json`:

```json
{
  "name": "hello-anybox",
  "version": "0.1.0",
  "description": "Create a concise project kickoff checklist.",
  "author": { "name": "Your Name" },
  "interface": {
    "displayName": {
      "zh-CN": "Hello Anybox",
      "en-US": "Hello Anybox"
    },
    "category": "Docs"
  },
  "skills": "skills"
}
```

The manifest is strict JSON. `name`, `version`, and `description` are required; unknown top-level fields prevent loading.

`skills/hello/SKILL.md`:

```md
---
name: Hello Anybox
description: Use when the user needs a concise project kickoff checklist.
---

# Hello Anybox

1. Restate the outcome in one sentence.
2. List the three key unknowns.
3. Propose the smallest useful milestone.
4. End with a verifiable checklist.
```

Each Skill root scans direct child folders only, and every child must contain `SKILL.md`. This example produces `plugin:hello-anybox:hello`.

## Install and Version

Publish the source in a public GitHub repository and copy the Raw URL that points to the manifest:

```text
https://raw.githubusercontent.com/<account>/<repo>/<branch>/hello-anybox/.anybox-plugin/plugin.json
```

On the Anybox Plugins page, select **Import URL**, review the capabilities, install, and enable the plugin for a project. Increase `version` for every release and never edit the managed installed copy.

A manifest hosted outside GitHub needs a real ZIP:

```json
{
  "package": {
    "type": "zip",
    "url": "https://downloads.example.com/hello-anybox-0.1.0.zip",
    "sha256": "<64-character-hex-digest>",
    "size": 12345
  }
}
```

The ZIP must use HTTPS, match its SHA-256, and contain no symlinks or paths that escape extraction.

## Add MCP Tools

Package a directly runnable MCP server and add this manifest field:

```json
{
  "mcpServers": [
    {
      "id": "hello",
      "name": "Hello Tools",
      "risk": "low",
      "permissions": ["Starts the bundled local Node.js process."],
      "tools": [
        {
          "name": "hello_echo",
          "title": "Echo Text",
          "description": "Return supplied text.",
          "readOnly": true,
          "destructive": false
        }
      ],
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/scripts/server.js"],
        "cwd": "${PLUGIN_ROOT}",
        "timeoutMs": 10000
      }
    }
  ]
}
```

The server must implement at least `initialize`, `tools/list`, and `tools/call`. Reserve stdio stdout for JSON-RPC and write logs to stderr. The installer does not run arbitrary dependency installation scripts, so release a directly runnable artifact. Every `${PLUGIN_ROOT}` path must remain inside the package.

## Add a Connector

Use `connectors` for plugin-owned credentials; never place a real key in `mcpServers.env`:

```json
{
  "connectors": [
    {
      "id": "weather",
      "name": "Weather API",
      "risk": "medium",
      "permissions": ["Sends requests to api.weather.example."],
      "credential": {
        "kind": "api_key",
        "key": "WEATHER_API_KEY",
        "label": "Weather API key",
        "type": "password",
        "required": true,
        "secret": true
      },
      "runtime": {
        "transport": "remote",
        "serverUrl": "https://api.weather.example/mcp",
        "headers": { "x-api-key": "${WEATHER_API_KEY}" },
        "requireApproval": "always"
      }
    }
  ]
}
```

The credential ID is `plugin-connector:hello-anybox:weather`; the real value is not written to generated MCP configuration. Use `connectorRequirements` when the plugin only needs an existing Gmail, GitHub, or other platform connection.

## Local Development

Point the runtime at a separate plugin source root:

```powershell
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\path\to\anybox-plugins"
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
```

macOS / Linux:

```bash
export ANYBOX_PLUGIN_LOCAL_DIR="/path/to/anybox-plugins"
export ANYBOX_PLUGIN_REGISTRY_INDEX_URL="off"
```

`ANYBOX_PLUGIN_LOCAL_DIR` is the parent of one or more plugin folders. Do not use the source repository as `ANYBOX_PLUGIN_INSTALL_DIR`; uninstall may delete managed copies there. Complete one real install, connection, diagnostic, and tool call in the desktop app.

## Release Checks

For the official catalog, run:

```text
pnpm plugins:index
pnpm plugins:index:check
pnpm plugins:catalog:prepare
pnpm plugins:catalog:verify
```

Before release, confirm:

- No keys, tokens, `.env` files, local databases, or authentication caches are committed.
- `permissions` accurately names processes, domains, and data effects.
- Read-only and destructive tools set `readOnly`, `destructive`, and approval policy correctly.
- `risk` is `low`, `medium`, or `high`; `critical` blocks installation.
- Relative paths stay in the package, placeholders have defined sources, and `version` is updated.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| URL import fails | HTTPS points to a supported manifest or GitHub package path |
| Plugin appears but cannot install | A non-GitHub source includes valid `package` metadata |
| Skill is not discovered | It is a direct child of a Skill root and contains `SKILL.md` |
| MCP has no tools | Command, `${PLUGIN_ROOT}`, `cwd`, protocol methods, and stdout logging |
| `PLUGIN_CONFIG_INVALID` | Required configuration, API key fields, or OAuth client settings |
