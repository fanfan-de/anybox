---
name: playwright-cli
description: Use when the user asks to inspect, test, debug, screenshot, trace, or automate a website or Playwright test flow through Playwright Agent CLI shell commands, including local web apps, browser sessions, snapshots, element refs, storage state, network mocking, console inspection, and visual verification.
---

# Playwright CLI

Use `playwright-cli` for browser automation when the user asks to open pages, inspect UI state, interact with elements, capture screenshots or PDFs, debug Playwright tests, record traces or videos, manage browser sessions, or verify a rendered frontend.

## Preconditions

- Require Node.js 20 or newer.
- Prefer `playwright-cli <command>` when the command is already installed.
- If unavailable, use `npx -y @playwright/cli@latest <command>`.
- To install globally, use `npm install -g @playwright/cli@latest`.
- If browser binaries are missing, run `playwright-cli install-browser` or `npx -y @playwright/cli@latest install-browser`.
- Use PowerShell syntax on Windows workspaces.

## First Checks

```powershell
playwright-cli --help
playwright-cli --version
```

If `playwright-cli` is not recognized:

```powershell
npx -y @playwright/cli@latest --help
```

## Core Workflow

Open the target, read the current page state, then use refs from the latest snapshot for deterministic interaction.

```powershell
playwright-cli open http://localhost:3000 --headed
playwright-cli snapshot
playwright-cli click <ref>
playwright-cli fill <ref> "text"
playwright-cli press Enter
playwright-cli screenshot
```

After each command, inspect the CLI output before deciding the next action. The output includes the current page state and may point to a snapshot file under `.playwright-cli/`; read that file when element refs or accessible names are needed.

## Useful Commands

Navigation:

```powershell
playwright-cli open <url> --headed
playwright-cli goto <url>
playwright-cli reload
playwright-cli go-back
playwright-cli go-forward
```

Interaction:

```powershell
playwright-cli click <ref>
playwright-cli dblclick <ref>
playwright-cli fill <ref> "value"
playwright-cli type "text"
playwright-cli check <ref>
playwright-cli uncheck <ref>
playwright-cli select <ref> "value"
playwright-cli hover <ref>
playwright-cli upload <file>
playwright-cli press Enter
```

Inspection and artifacts:

```powershell
playwright-cli snapshot
playwright-cli screenshot
playwright-cli screenshot <ref>
playwright-cli pdf
playwright-cli console error
playwright-cli eval "() => document.title"
playwright-cli run-code "async ({ page }) => await page.title()"
```

Sessions and browser mode:

```powershell
playwright-cli -s=my-session open http://localhost:3000 --headed
playwright-cli list
playwright-cli close
playwright-cli close-all
playwright-cli open --browser=firefox
playwright-cli open --persistent
playwright-cli open --profile=.playwright-profile
```

Storage and auth:

```powershell
playwright-cli state-save .playwright-cli/auth.json
playwright-cli state-load .playwright-cli/auth.json
playwright-cli cookie-list
playwright-cli localstorage-list
playwright-cli sessionstorage-list
```

Tracing and video:

```powershell
playwright-cli tracing-start
playwright-cli tracing-stop
playwright-cli video-start session.webm
playwright-cli video-chapter "checkout flow"
playwright-cli video-stop
```

## Local App Verification

When verifying a local frontend, make sure the dev server is running before opening the page. Use `--headed` for visual work and screenshots. Check at least:

- The page is not blank.
- Main interactive controls are visible and clickable.
- Text does not visibly overlap or overflow.
- Console output has no relevant errors.
- Screenshots show the expected state.

## Safety Rules

- Ask before submitting real forms, making purchases, deleting content, changing production data, or interacting with authenticated third-party accounts.
- Prefer local URLs, staging sites, and test accounts unless the user explicitly asks for a real external site.
- Keep destructive browser actions out of scripted loops unless the user has approved the exact target and effect.
- Do not store secrets in committed storage-state files. Use local ignored paths for auth artifacts.
- If a command fails, run `playwright-cli --help` or the relevant help output before guessing syntax.
