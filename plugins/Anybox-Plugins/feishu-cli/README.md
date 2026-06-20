# Feishu CLI Anybox Plugin

This is a skill-only Anybox plugin for the official `lark-cli` command-line tool. It bundles the official `lark-*` skill set plus a small Anybox overview skill. It does not add an MCP server and does not store Feishu or Lark credentials.

## What It Does

The bundled skill teaches the agent to:

- Check whether `lark-cli` is installed.
- Initialize CLI app configuration.
- Start and verify login.
- Prefer safe, structured `lark-cli` commands with JSON output.
- Use dry-run and confirmation for write operations.
- Work with Feishu/Lark messages, docs, drive, calendar, sheets, base, tasks, mail, meetings, approvals, OKRs, wiki, events, minutes, and raw OpenAPI fallback commands.

## Prerequisites

Install the official CLI when needed:

```powershell
npx @larksuite/cli@latest install
```

Then configure and log in:

```powershell
lark-cli config init --new
lark-cli auth login --recommend
lark-cli auth status
```

The CLI manages credentials through its own local credential storage. This plugin only provides the Anybox skill that tells the agent how to use the CLI safely.
