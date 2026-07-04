---
name: fanfande-plugin-structure
description: Build, explain, review, or validate current Anybox/Fanfande-derived plugin packages. Use when the user asks how to structure a plugin folder, write root plugin.json, add plugin MCP servers, bundle plugin skills, define app connectors or connector requirements, create plugin registry manifests, migrate away from plugin.meta.json or zip artifacts, or check whether a plugin package matches the current plugin system.
---

# Fanfande / Anybox Plugin Structure

## Source Of Truth

Use this skill for the current plugin package format used in the Anybox codebase. The old Fanfande paths and `.fanfande-plugin/plugin.json` layout are historical unless the live target repo proves otherwise.

Treat these files as the implementation source when schema details may have changed:

- `packages/anyboxagent/src/plugin/plugin.ts`
- `packages/anyboxagent/Test/plugin.test.ts`
- `plugins/Anybox-Plugins/index.json`
- `plugins/Anybox-Plugins/hyperframes/plugin.json`
- `plugins/Anybox-Plugins/anybox-plugin-development/docs/anybox-third-party-plugin-development.md`

Prefer the running code in `plugin.ts` over older docs when they disagree.

## Current Format Summary

The current built-in plugin registry is an expanded source tree:

```text
plugins/Anybox-Plugins/
  index.json
  <plugin-id>/
    plugin.json
    skills/
    connectors/
    scripts/
    docs/
    assets/
```

Important rules:

- Put `plugin.json` at the plugin directory root.
- Do not use `plugin.meta.json`.
- Do not commit zip artifacts to the built-in expanded registry.
- `plugins/Anybox-Plugins/index.json` is a JSON array of direct HTTPS `plugin.json` URLs.
- Directory registry URLs are not supported.
- `.anybox-plugin/plugin.json` is accepted only as a legacy package manifest location.
- `.fanfande-plugin/plugin.json` is not the current Anybox runtime format.

## Package Layout

For development, use a plugin source root whose children are plugin package folders:

- `ANYBOX_PLUGIN_LOCAL_DIR`, when set.
- Otherwise the agent data directory's `plugins/local`.

For managed installs, the runtime copies packages to:

- `ANYBOX_PLUGIN_INSTALL_DIR`, when set.
- Otherwise the agent data directory's `plugins/installed`.

Preferred expanded package layout:

```text
<plugin-source-root>/
  <plugin-id>/
    plugin.json
    skills/
      <skill-name>/
        SKILL.md
    connectors/
    scripts/
      server.js
    docs/
    assets/
```

Versioned package directories are still accepted, mostly for managed installs and legacy packages:

```text
<plugin-source-root>/
  <plugin-id>/
    <version>/
      plugin.json
      skills/
        <skill-name>/
          SKILL.md
```

The legacy Anybox layout is also accepted:

```text
<plugin-source-root>/
  <plugin-id>/
    <version>/
      .anybox-plugin/
        plugin.json
      skills/
```

Keep `assets`, `docs`, `scripts`, `connectors`, and `skills` next to `plugin.json`, not inside `.anybox-plugin`.

Use lowercase stable plugin IDs. The runtime normalizes `plugin.json` `name` to lowercase to form `pluginID`; keep the folder name, manifest `name`, and registry URL path aligned.

If a package folder contains multiple version subdirectories, the catalog chooses the highest manifest `version` for the same normalized plugin ID.

## Manifest Rules

Write `plugin.json` as strict JSON. Unknown top-level fields are rejected.

Minimal runtime manifest:

```json
{
  "name": "manifest-lab",
  "version": "0.1.0",
  "description": "Fixture plugin package with MCP, skills, and connectors."
}
```

Supported runtime top-level fields:

- `name`: Required. Normalized to lowercase as the plugin ID.
- `version`: Required. Used for version selection and package matching.
- `description`: Required. Fallback marketplace description.
- `author`: String or object with at least `name`.
- `homepage`, `repository`, `license`: Optional metadata.
- `keywords`: Optional string array. Merged into catalog tags.
- `interface`: Optional marketplace and UI metadata.
- `mcpServers`: Optional array of MCP server templates.
- `skills`: Optional string or string array of skill root directories; defaults to `"skills"`.
- `connectorRequirements`: Optional platform connector requirements, such as Gmail.
- `connectors`: Preferred plugin-owned connector declarations.
- `apps`: Legacy alias for plugin-owned connectors.
- `commands`, `agents`: Reserved fields; accepted but not executed by the plugin runtime.

Repository or remote registry `plugin.json` files may additionally include registry-only fields:

- `skillPreviews`: Marketplace preview data for remote catalog entries.
- `package`: Optional zip download metadata. Include this only when a real downloadable artifact exists.
- `id`: Optional registry ID override; normally avoid it and use `name`.

The runtime strips `id`, `skillPreviews`, and `package` before validating the runtime manifest. For the built-in expanded registry, omit `package` because the package source is already present in the repository.

Include at least one real capability in `mcpServers`, `skills`, `connectorRequirements`, or `connectors` for an installable package. Metadata-only remote registry entries can appear in the catalog, but they are not installable unless they include a valid `package` download or a matching local expanded package exists.

## Interface Metadata

Use `interface` for marketplace rendering:

```json
{
  "interface": {
    "displayName": "Manifest Lab",
    "shortDescription": "Review docs and notes.",
    "longDescription": "Longer marketplace detail text.",
    "developerName": "Anybox Tests",
    "category": "Docs",
    "capabilities": ["docs", "review"],
    "websiteURL": "https://example.com",
    "composerIcon": "./assets/icon.png",
    "logo": "./assets/logo.png",
    "iconUrl": "./assets/icon.png",
    "thumbnailUrl": "./assets/thumb.png",
    "heroImageUrl": "./assets/hero.png",
    "screenshots": ["./assets/screen.png"],
    "brandColor": "#2F6FED"
  }
}
```

Valid catalog categories are `Code`, `Browser`, `Git`, `Database`, `Docs`, `Automation`, and `Design`. The runtime maps `engineering` and `coding` to `Code`, and `productivity` and `documentation` to `Docs`; prefer exact category names.

Display assets can be `https://`, `data:image/`, or package-relative paths.

- Local package-relative assets are exposed as displayable data URLs when the file exists and uses a supported image type.
- Remote registry manifest relative assets are resolved against the manifest URL, for example `https://raw.githubusercontent.com/.../<plugin-id>/plugin.json` plus `./assets/icon.png`.

## MCP Servers

Define `mcpServers` when the plugin adds one or more MCP servers. Each entry accepts:

- `id`: Optional. Defaults to `default`.
- `name`: Optional. Defaults to `interface.displayName` or manifest `name`.
- `description`: Optional. Defaults to manifest `description`.
- `risk`: Optional; `low`, `medium`, `high`, or `critical`. Defaults to `medium`.
- `permissions`: Optional user-facing permission strings.
- `tools`: Optional preview list for marketplace display.
- `configFields`: Optional install-time plugin config fields.
- `runtime`: Required stdio or remote MCP runtime.
- `installReview`: Optional review notes shown before install.

Use `tools` as display and policy hints, not as implementation:

```json
{
  "name": "list_notes",
  "title": "List Notes",
  "description": "List fixture notes.",
  "readOnly": true,
  "destructive": false
}
```

Use `configFields` for plugin-level configuration. Supported field keys are `key`, `label`, `type`, `required`, `secret`, `placeholder`, `defaultValue`, and `description`. Valid `type` values are `text`, `password`, `url`, and `path`. Required fields are enforced during install or update.

### Stdio Runtime

Use stdio for local MCP servers bundled with the package:

```json
{
  "runtime": {
    "transport": "stdio",
    "command": "node",
    "args": ["${PLUGIN_ROOT}/scripts/server.js"],
    "cwd": "${PLUGIN_ROOT}",
    "env": {
      "DOCS_TOKEN": "${DOCS_TOKEN}"
    },
    "timeoutMs": 1000
  }
}
```

`command`, `args`, `env`, and `cwd` support placeholders of the form `${UPPER_CASE_KEY}`. The runtime supplies `PLUGIN_ROOT` and any installed plugin config values.

### Remote Runtime

Use remote runtime for direct remote MCP servers:

```json
{
  "runtime": {
    "transport": "remote",
    "serverUrl": "https://docs.example.test/mcp",
    "headers": {
      "authorization": "Bearer ${DOCS_TOKEN}"
    },
    "allowedTools": {
      "readOnly": true
    },
    "requireApproval": "never",
    "timeoutMs": 1000
  }
}
```

Remote runtime may also include `provider`, `connectorId`, `authorization`, `serverDescription`, `toolPolicies`, and `requireApproval`.

Do not mark a plugin `critical` unless install should be blocked. The installer rejects `critical` risk catalog items.

## Plugin Skills

Use `skills` to bundle Codex/Anybox skills inside the plugin package. If omitted, the runtime looks under `skills`.

```text
<package-root>/
  skills/
    review/
      SKILL.md
    release-notes/
      SKILL.md
```

The runtime discovers only direct subdirectories under each declared skill root. Each discovered skill directory must contain `SKILL.md`.

`SKILL.md` should include normal skill frontmatter:

```markdown
---
name: Review Notes
description: Review docs produced by this plugin.
---

# Review Notes

Use this skill to review generated documentation notes.
```

Generated plugin skill IDs use:

```text
plugin:<pluginID>:<skill-directory-name>
```

For example, `manifest-lab` with `skills/review/SKILL.md` becomes `plugin:manifest-lab:review`.

When using multiple skill roots, keep skill directory names unique. The current ID format uses the immediate skill directory name, not the full root path.

## Connectors

Use `connectors` when the plugin exposes a plugin-owned remote or local connector. `apps` is still parsed as a legacy alias, but prefer `connectors` in new manifests.

Each connector entry accepts:

- `appID`: Required stable ID inside the plugin.
- `name`: Required display name.
- `description`, `icon`, `risk`, `permissions`, `tools`, `installReview`: Optional metadata.
- `credential` or `configFields`: Configuration and secret metadata.
- `runtime`: Required remote or stdio runtime.

Example API-key connector:

```json
{
  "connectors": [
    {
      "appID": "docs",
      "name": "Docs API",
      "description": "Remote MCP connector for docs search.",
      "risk": "medium",
      "permissions": ["Sends requests to docs.example.test"],
      "tools": [
        {
          "name": "search_docs",
          "description": "Search docs.",
          "readOnly": true
        }
      ],
      "credential": {
        "key": "DOCS_API_KEY",
        "label": "Docs API key",
        "type": "password",
        "required": true,
        "secret": true
      },
      "runtime": {
        "transport": "remote",
        "serverUrl": "https://docs.example.test/mcp",
        "headers": {
          "x-api-key": "${DOCS_API_KEY}"
        },
        "allowedTools": {
          "readOnly": true
        },
        "requireApproval": "always"
      }
    }
  ]
}
```

Connector secrets are stored in the credential store. The generated global MCP server keeps only `connectorId`; `serverUrl`, `authorization`, and `headers` are resolved at runtime after the connector is connected.

Use `connectorRequirements` when a plugin depends on a platform connector managed by Anybox, such as Gmail:

```json
{
  "connectorRequirements": [
    {
      "connector": "gmail",
      "tools": ["gmail_profile", "gmail_search_messages"],
      "permissions": [
        "Read the connected Gmail profile summary.",
        "Search Gmail messages with Gmail search syntax."
      ],
      "required": true,
      "reason": "Read-only Gmail access through the Anybox Gmail connector."
    }
  ]
}
```

## Generated IDs

Use these generated IDs when explaining, testing, or debugging plugin installation:

- Plugin ID: normalized manifest `name`.
- Default MCP server: `plugin.<pluginID>`.
- Named MCP server: `plugin.<pluginID>.<serverID>`.
- Plugin-owned connector credential ID: `plugin-connector:<pluginID>:<connectorID>`.
- Legacy app connector credential ID: `plugin-app:<pluginID>:<appID>`.
- Plugin-owned connector MCP server: `plugin.<pluginID>.connector.<connectorID>`.
- Legacy app connector MCP server: `plugin.<pluginID>.app.<appID>`.
- Plugin skill: `plugin:<pluginID>:<skill-directory-name>`.

## Registry Manifests

Local registry files are loaded from bundled registry paths and from `ANYBOX_PLUGIN_REGISTRY_FILES`, split by the OS path delimiter. Registry files still use:

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "name": "remote-lab",
      "version": "1.2.3",
      "description": "Remote fixture plugin.",
      "interface": {
        "displayName": "Remote Lab",
        "shortDescription": "Remote fixture.",
        "category": "Docs"
      },
      "skillPreviews": [
        {
          "name": "Review Notes",
          "description": "Review docs.",
          "directory": "review"
        }
      ],
      "mcpServers": []
    }
  ]
}
```

Remote registry loading uses `ANYBOX_PLUGIN_REGISTRY_INDEX_URL`, defaulting to:

```text
https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/index.json
```

Set it to `off`, `none`, or `disabled` during local validation.

Remote `index.json` must be a JSON array of direct HTTPS manifest URLs:

```json
[
  "https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/hyperframes/plugin.json"
]
```

Rules for remote registry entries:

- Every entry must point directly to `plugin.json`.
- Directory URLs are not supported.
- `plugin.meta.json` is not supported.
- GitHub `blob` URLs may be normalized to `raw.githubusercontent.com`, but raw URLs are preferred.
- Remote relative display assets resolve against the manifest URL.

Remote `plugin.json` can include `skillPreviews` for catalog display. Include `package` only for a real downloadable zip artifact:

```json
{
  "package": {
    "type": "zip",
    "url": "https://cdn.example.test/remote-lab.zip",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "size": 12345
  }
}
```

Package downloads must be HTTPS zip files with a matching SHA-256. Archives must not contain symlinks or paths outside the extraction directory. A downloaded package must contain exactly one manifest matching the registry plugin ID and version.

For the built-in expanded registry under `plugins/Anybox-Plugins`, do not keep zip artifacts and do not keep `package` fields unless the referenced artifact is intentionally published and validated.

## Validation Workflow

When building, migrating, or reviewing a plugin package:

1. Confirm the package root contains root `plugin.json`.
2. Treat `.anybox-plugin/plugin.json` as legacy compatibility only.
3. Do not create `.fanfande-plugin/plugin.json` for current Anybox packages.
4. Check `plugin.json` is valid JSON and uses only supported schema fields.
5. Check every declared skill root stays inside the package and contains direct skill subdirectories with `SKILL.md`.
6. Check every stdio runtime path works from `${PLUGIN_ROOT}` or declares an explicit `cwd`.
7. Check required `configFields` match every placeholder used by MCP runtimes.
8. Check connector placeholders match `credential.key` or connector config fields.
9. Check `connectorRequirements` reference platform connector IDs that exist in the app.
10. Check risk is not `critical` unless blocked installation is intended.
11. For `plugins/Anybox-Plugins/index.json`, verify every entry ends with `/plugin.json`.
12. For the built-in expanded registry, verify there are no `*.zip`, no `plugin.meta.json`, and no root `package` fields unless explicitly intended.
13. Run a catalog load against the candidate package:

```powershell
cd C:\Projects\Anybox\packages\anyboxagent
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\path\to\plugin-source-root"
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
bun -e "import * as Plugin from './src/plugin/plugin.ts'; console.log(JSON.stringify(await Plugin.listCatalog(), null, 2))"
```

14. Run the plugin regression tests after changing plugin-system code:

```powershell
cd C:\Projects\Anybox\packages\anyboxagent
bun test Test/plugin.test.ts
```

## Complete Minimal Package

```text
plugin-source-root/
  manifest-lab/
    plugin.json
    skills/
      review/
        SKILL.md
    scripts/
      server.js
```

```json
{
  "name": "manifest-lab",
  "version": "0.1.0",
  "description": "Fixture plugin package with MCP and skills.",
  "author": {
    "name": "Anybox Tests"
  },
  "interface": {
    "displayName": "Manifest Lab",
    "shortDescription": "Fixture plugin package.",
    "developerName": "Anybox Tests",
    "category": "Docs",
    "logo": "ML"
  },
  "mcpServers": [
    {
      "id": "notes",
      "name": "Manifest Notes",
      "risk": "low",
      "permissions": ["Starts a bundled stdio MCP server"],
      "tools": [
        {
          "name": "list_notes",
          "description": "List fixture notes.",
          "readOnly": true
        }
      ],
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/scripts/server.js"],
        "cwd": "${PLUGIN_ROOT}",
        "timeoutMs": 1000
      }
    }
  ],
  "skills": "skills"
}
```
