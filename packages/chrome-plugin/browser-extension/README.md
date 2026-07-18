# Anybox Chrome Extension

Chrome extension bridge for the Anybox Chrome plugin.

## Development

Build the extension:

```bash
corepack pnpm --filter anybox-chrome-extension build
```

Load the unpacked extension from:

```text
packages/chrome-plugin/browser-extension/dist
```

Start Anybox Agent before loading or reconnecting the extension:

```bash
corepack pnpm --dir packages/anyboxagent run dev:server
```

The extension first tries Chrome Native Messaging host `com.anybox.browser`. If that host is unavailable, it falls back to:

```text
ws://127.0.0.1:4096/api/browser-extension/ws
```

Set `ANYBOX_FORCE_WEBSOCKET_BRIDGE` to `true` in extension local storage to force the fallback path during development.

Check bridge status:

```bash
curl http://127.0.0.1:4096/api/browser-extension/status
```

## MVP Commands

- `tabs.list`
- `tabs.open`
- `tabs.activate`
- `page.snapshot`
- `page.domTree`
- `page.accessibilityTree`
- `page.screenshot`
- `page.click`
- `page.type`
- `page.scroll`
