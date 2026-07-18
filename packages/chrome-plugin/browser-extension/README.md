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

The extension connects only through Chrome Native Messaging host
`com.anybox.browser`. Start Anybox Agent before loading or reconnecting the
extension so the managed plugin runtime can install the host configuration and
its short-lived transport credential.

Browser-extension status and command endpoints are authenticated internal
interfaces. They are accessed by the managed Chrome plugin runtime rather than
directly from extension pages or browser-origin HTTP requests.

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
