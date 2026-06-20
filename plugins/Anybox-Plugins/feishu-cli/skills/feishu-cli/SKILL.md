---
name: feishu-cli
description: Use when the user wants to operate Feishu or Lark through the official lark-cli command-line tool from shell commands, including setup, authentication, messages, docs, calendar, sheets, base, tasks, mail, meetings, approvals, and raw OpenAPI calls.
---

# Feishu CLI

Use this skill when the user asks to use Feishu, Lark, Feishu CLI, Lark CLI, or `lark-cli` from the agent shell. This is a CLI-first workflow, not an MCP workflow. Use shell commands to call `lark-cli` directly.

## Operating Model

- Prefer `lark-cli` for Feishu/Lark work instead of direct HTTP calls when this skill is active.
- Treat `lark-cli` as the owner of app configuration, OAuth login, scopes, user/bot identity selection, and local credential storage.
- Do not ask the user for access tokens, refresh tokens, app secrets, or cookies. Do not print or save secrets.
- Use `--format json` for read commands whenever supported so results are machine-readable.
- Keep commands narrow and explicit. Avoid raw OpenAPI calls unless a shortcut or service command cannot do the job.

## Setup Checks

First check whether the CLI is available:

```powershell
lark-cli --version
```

If it is missing, tell the user it needs to be installed, then use the official installer when the user wants you to proceed:

```powershell
npx @larksuite/cli@latest install
```

After installation, initialize app configuration if needed:

```powershell
lark-cli config init --new
```

Then check login state:

```powershell
lark-cli auth status
```

If not logged in, start login with recommended scopes:

```powershell
lark-cli auth login --recommend
```

For agent-driven browser handoff, use non-blocking login when appropriate and relay only the authorization URL or next safe instruction to the user:

```powershell
lark-cli auth login --recommend --no-wait
```

## Safety Rules

- Before sending messages, modifying documents, updating calendars, changing records, approving requests, deleting anything, or calling raw write APIs, get explicit user confirmation unless the user has already clearly asked for that exact action.
- For write commands that support it, run `--dry-run` first and summarize the intended change before executing the real command.
- Do not add the Feishu/Lark bot to public or broad group chats as part of setup. If group access is needed, ask the user to handle membership deliberately.
- Never run broad destructive commands such as bulk delete, recursive permission changes, or mass updates unless the user explicitly scopes the target set.
- When a command fails for missing scope or permission, report the missing capability and use `lark-cli auth check` or `lark-cli auth login` with a narrower domain or scope instead of retrying blindly.

## Common Commands

Check authentication:

```powershell
lark-cli auth status
lark-cli auth list
lark-cli auth scopes
```

Calendar examples:

```powershell
lark-cli calendar +agenda --format json
lark-cli calendar +agenda --as user --format json
```

Messages:

```powershell
lark-cli im +messages-send --as bot --chat-id "oc_xxx" --text "Hello" --dry-run
lark-cli im +messages-send --as bot --chat-id "oc_xxx" --text "Hello"
```

Docs:

```powershell
lark-cli docs +create --api-version v2 --doc-format markdown --content "<title>Title</title>`n# Heading`nContent"
```

Raw API fallback:

```powershell
lark-cli api GET /open-apis/calendar/v4/calendars --format json
lark-cli api POST /open-apis/im/v1/messages --params "{\"receive_id_type\":\"chat_id\"}" --data "{\"receive_id\":\"oc_xxx\",\"msg_type\":\"text\",\"content\":\"{\\\"text\\\":\\\"Hello\\\"}\"}" --dry-run
```

## Workflow

1. Identify whether the task is read-only or a write action.
2. Run setup checks only when the current CLI/auth state is unknown.
3. Choose the highest-level shortcut command first, then service commands, then raw API as a last resort.
4. For read tasks, return a concise summary and mention key IDs only when useful.
5. For write tasks, dry-run when available, confirm the target and content, then execute.
6. If output is too large, rerun with narrower filters, pagination, or a more specific command.

## Troubleshooting

- If `lark-cli` is not recognized, install it or ensure the install directory is on `PATH`.
- If login requires browser interaction, provide the authorization URL or instruction and wait for the user to complete it.
- If the CLI says a scope is missing, use `lark-cli auth check` for the relevant scope and ask the user to reauthorize with the needed scope.
- If a Feishu command cannot access a resource, verify whether the current identity is `user` or `bot` and rerun with `--as user` or `--as bot` when appropriate.
