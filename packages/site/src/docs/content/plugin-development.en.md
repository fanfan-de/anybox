# Build Plugins

An Anybox plugin is an installable capability package. It can contain only a Skill that guides the agent, or it can add MCP tools, plugin-owned connectors, and requirements for platform connectors.

This guide starts with the smallest useful plugin you can install, then shows how to add tools and connected services.

> This page follows the current Anybox runtime. New plugins use `.anybox-plugin/plugin.json`; root `plugin.json` and `.codex-plugin/plugin.json` are compatibility inputs only. Do not use the old `.fanfande-plugin/plugin.json` or `plugin.meta.json`, and do not place generated ZIP files in an expanded plugin source directory.

## Choose the Capability First

| Capability | Use it for | Location |
| --- | --- | --- |
| Skill | Agent workflows, domain knowledge, and operating rules | `skills/<skill-name>/SKILL.md` |
| MCP server | Local or remote tools that perform actions | `mcpServers` in the manifest |
| Connector | A plugin-specific API key or OAuth connection | `connectors` in the manifest |
| Connector requirement | Reuse a platform connection such as Gmail or GitHub | `connectorRequirements` in the manifest |

If you only need to teach the agent a repeatable workflow, start with a Skill. Add an MCP server or connector only when the plugin must execute code or exchange external data.

## Build Your First Plugin in Five Minutes

The following `hello-anybox` plugin contains one Skill. It requires no build tool or third-party dependency.

### 1. Create the folders

```text
anybox-plugins/
  hello-anybox/
    .anybox-plugin/
      plugin.json
    skills/
      hello/
        SKILL.md
```

`anybox-plugins` is a source root that can hold multiple plugin packages. `hello-anybox` is the package itself. Keep the folder name, manifest `name`, and published URL path aligned, using a stable lowercase ID.

### 2. Write plugin.json

Create `hello-anybox/.anybox-plugin/plugin.json`:

```json
{
  "name": "hello-anybox",
  "version": "0.1.0",
  "description": "A small Anybox plugin for learning the plugin workflow.",
  "author": {
    "name": "Your Name"
  },
  "repository": "https://github.com/your-name/anybox-plugins",
  "interface": {
    "displayName": {
      "zh-CN": "Hello Anybox",
      "en-US": "Hello Anybox"
    },
    "shortDescription": {
      "zh-CN": "通过一个简单 Skill 学习 Anybox 插件。",
      "en-US": "Learn Anybox plugins with one simple Skill."
    },
    "longDescription": {
      "zh-CN": "安装后，Agent 会按照随包 Skill 生成清晰的项目启动清单。",
      "en-US": "After installation, the bundled Skill helps the agent create a clear project kickoff checklist."
    },
    "developerName": "Your Name",
    "category": "Docs",
    "capabilities": ["skill", "project-planning"],
    "logo": "HA",
    "brandColor": "#2563EB"
  },
  "skills": "skills",
  "skillPreviews": [
    {
      "name": "Hello Anybox",
      "description": "Create a concise project kickoff checklist.",
      "directory": "hello"
    }
  ]
}
```

`plugin.json` is strict JSON, so comments and trailing commas are not valid. `name`, `version`, and `description` are required. An unknown top-level field prevents the plugin from loading.

`skillPreviews` provides catalog information before installation. The runtime strips it while validating the installed manifest; it does not create a separate executable capability.

### 3. Write SKILL.md

Create `hello-anybox/skills/hello/SKILL.md`:

```markdown
---
name: Hello Anybox
description: Use when the user wants a concise kickoff checklist for a new project.
---

# Hello Anybox

When the user asks to start or plan a project:

1. Restate the intended outcome in one sentence.
2. List the three most important unknowns.
3. Propose the smallest useful first milestone.
4. End with a checklist the user can verify.
```

Anybox scans only direct child folders under each declared Skill root, and every child must contain `SKILL.md`. This example produces the following Skill ID after installation:

```text
plugin:hello-anybox:hello
```

### 4. Publish and install it

Push `anybox-plugins` to a public GitHub repository, then copy the Raw URL that points directly to the manifest:

```text
https://raw.githubusercontent.com/<account>/<repo>/<branch>/hello-anybox/.anybox-plugin/plugin.json
```

Open the Plugins page in Anybox:

1. Select **Import URL**.
2. Paste the HTTPS manifest URL and import it.
3. Review the plugin metadata and capabilities, then install it.
4. Enable the plugin for a project, create a session, and ask the agent to “prepare a kickoff checklist for this project.”

When you import a GitHub Raw URL, Anybox can download the GitHub directory containing the manifest as the plugin package. A manifest hosted elsewhere needs a real downloadable zip and `package` metadata, described later in this guide.

Increase `version` for every release, for example from `0.1.0` to `0.1.1`. Do not edit the managed installed copy directly.

## Common Manifest Fields

| Field | Purpose |
| --- | --- |
| `name`, `version`, `description` | Required plugin identity, version, and base description |
| `author`, `homepage`, `repository`, `license`, `keywords` | Author and project metadata |
| `interface` | Display names, descriptions, category, images, and brand color |
| `skills` | One Skill root or an array of roots; defaults to `skills` |
| `mcpServers` | MCP servers supplied by the plugin |
| `connectors` | Connections owned by the plugin and removed with it |
| `connectorRequirements` | Platform connectors required by the plugin |
| `skillPreviews`, `package` | Publication metadata used by remote catalogs and installation |

Preferred categories are `Code`, `Browser`, `Git`, `Database`, `Docs`, `Automation`, and `Design`. Display images can use HTTPS, `data:image/`, or a package-relative path such as `./assets/icon.png`.

`apps` is a legacy alias for `connectors`; use `connectors` in new plugins. `commands` and `agents` are currently reserved fields and should not be treated as executable capabilities.

When a manifest grows, `mcpServers` and `connectors` can reference package-relative JSON files:

```json
{
  "mcpServers": "./mcp.json",
  "connectors": "./connectors.json"
}
```

These paths must stay inside the package. Remote component files must have the same origin as the manifest.

## Add MCP Tools

Add an MCP server when the agent must execute code:

```text
hello-anybox/
  .anybox-plugin/
    plugin.json
  scripts/
    server.js
  skills/
    hello/
      SKILL.md
```

Add the following field to `plugin.json`:

```json
{
  "mcpServers": [
    {
      "id": "hello",
      "name": "Hello Tools",
      "description": "Local tools bundled with Hello Anybox.",
      "risk": "low",
      "permissions": [
        "Starts a local Node.js process bundled with this plugin."
      ],
      "tools": [
        {
          "name": "hello_echo",
          "title": "Echo Text",
          "description": "Return the supplied text.",
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

This is only the server declaration. `scripts/server.js` must implement MCP and correctly handle at least `initialize`, `tools/list`, and `tools/call`. A local stdio server must reserve stdout for JSON-RPC messages and write ordinary logs to stderr.

The installer does not run arbitrary dependency installation scripts. If the server uses third-party packages, include a directly runnable build artifact or the required dependencies in the released package. Every `${PLUGIN_ROOT}` path must remain inside the package.

The generated server ID is:

```text
plugin.hello-anybox.hello
```

## Add a Connector for Credentials

Use `connectors` when a plugin needs its own API key or OAuth lifecycle. Do not put a real secret directly into `mcpServers.env`.

This remote connector stores an API key when the user connects it and injects the value into a request header only at runtime:

```json
{
  "connectors": [
    {
      "id": "weather",
      "name": "Weather API",
      "description": "Read current weather from the example service.",
      "risk": "medium",
      "permissions": [
        "Sends requests to api.weather.example."
      ],
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
        "headers": {
          "x-api-key": "${WEATHER_API_KEY}"
        },
        "allowedTools": {
          "readOnly": true
        },
        "requireApproval": "always",
        "timeoutMs": 10000
      },
      "tools": [
        {
          "name": "weather_current",
          "title": "Current Weather",
          "description": "Read current weather for a city.",
          "readOnly": true
        }
      ]
    }
  ]
}
```

Installation generates the credential ID `plugin-connector:hello-anybox:weather` and the MCP server ID `plugin.hello-anybox.connector.weather`. The generated MCP configuration does not contain the real key.

Use `connectorRequirements` instead when a plugin only needs an existing Anybox Gmail, GitHub, or other platform connection. Multiple plugins can then share one user authorization instead of storing separate credentials.

## Local Development and Validation

Development and packaged desktop builds behave the same by default: both read the stable remote `.catalog/anybox-plugin-registry.json` and do not automatically scan plugin source packages in the Anybox repository.

When developing an independent plugin repository, point the runtime at a separate local plugin source:

```powershell
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\path\to\anybox-plugins"
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
```

On macOS or Linux:

```bash
export ANYBOX_PLUGIN_LOCAL_DIR="/path/to/anybox-plugins"
export ANYBOX_PLUGIN_REGISTRY_INDEX_URL="off"
```

`ANYBOX_PLUGIN_LOCAL_DIR` must point to the parent containing one or more plugin folders. Do not use your source repository as `ANYBOX_PLUGIN_INSTALL_DIR`: that is a managed installation root, and uninstalling a plugin may delete its managed copy.

To debug the Anybox repository's own `plugins/Anybox-Plugins` source packages directly, opt in explicitly:

```powershell
$env:ANYBOX_PLUGIN_INCLUDE_SOURCE_PACKAGES = "1"
```

Keep this variable at `0` when verifying production-equivalent behavior.

If you have cloned the Anybox source, inspect the catalog from the Agent package:

```powershell
cd packages/anyboxagent
bun -e "import * as Plugin from './src/plugin/plugin.ts'; console.log(JSON.stringify(await Plugin.listCatalog(), null, 2))"
```

In addition to inspecting catalog output, complete one real install, connection, diagnostic, and tool call in the desktop app.

## Distribute the Plugin

The simplest third-party distribution method is a public GitHub repository and an HTTPS Raw URL that points directly to `.anybox-plugin/plugin.json`. The runtime also accepts supported GitHub `blob`, `tree`, and raw package paths as compatibility inputs.

For a manifest hosted outside GitHub, add real zip download metadata:

```json
{
  "package": {
    "type": "zip",
    "url": "https://downloads.example.com/hello-anybox-0.1.0.zip",
    "sha256": "64-character-lowercase-or-uppercase-hex-digest",
    "size": 12345
  }
}
```

The zip must use HTTPS and match the declared SHA-256. It cannot contain symbolic links or paths that escape the extraction directory, and it must contain exactly one manifest matching the plugin ID and version.

To propose a plugin for the official Anybox catalog, submit both its source and the locally prepared catalog files:

1. Add the expanded source under `plugins/Anybox-Plugins/<plugin-id>/` and increase the plugin's own `version`.
2. Run `pnpm plugins:index` and `pnpm plugins:index:check`, then commit the plugin source and `index.json` first.
3. Run `pnpm plugins:catalog:prepare` and `pnpm plugins:catalog:verify`.
4. Commit the generated `.catalog/anybox-plugin-registry.json`, catalog manifest, and versioned ZIP files under `.catalog/packages/`, then use a normal `git push`.

`index.json` is a local catalog build input, not the runtime catalog fetched by clients. Desktop clients read the stable `.catalog/anybox-plugin-registry.json` and download a selected ZIP only during installation. The entire publication flow runs locally and does not depend on GitHub Actions, GitHub Releases, or the GitHub API, nor is it tied to a desktop version.

## Security and Release Checklist

Before publishing, confirm that:

- The repository contains no API keys, OAuth secrets, access tokens, refresh tokens, `.env` files, local databases, or authentication caches.
- `permissions` accurately states which processes start, which domains are contacted, and which data is read or changed.
- Read-only tools use `readOnly: true`. Destructive tools use `destructive: true` and an appropriate approval policy.
- `risk` is `low`, `medium`, or `high`. `critical` blocks installation and is not a general-purpose high-risk label.
- Runtime files and relative paths stay inside the plugin package.
- Every `${PLACEHOLDER}` has a source such as `PLUGIN_ROOT`, installation configuration, or a connector credential.
- `version` has been increased and the manifest is valid strict JSON.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| URL import fails | The URL must use HTTPS; prefer `.anybox-plugin/plugin.json`, or use a supported GitHub `blob`, `tree`, or raw package path |
| The plugin appears but cannot be installed | A manifest hosted outside GitHub normally needs valid `package` download metadata |
| A local plugin is missing from the catalog | Check the source root, manifest entry point, required fields, unknown top-level fields, and JSON syntax |
| A Skill is not discovered | It must be a direct child of a declared Skill root and contain `SKILL.md` |
| MCP diagnostics find no tools | Check the command, `${PLUGIN_ROOT}` path, `cwd`, protocol methods, and whether ordinary logs are reaching stdout |
| Installation reports `PLUGIN_CONFIG_INVALID` | Check required `configFields`, API key fields, and OAuth client configuration |

