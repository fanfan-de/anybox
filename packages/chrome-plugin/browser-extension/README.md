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

Build the plugin-owned Browser Host before loading or reconnecting the extension:

```bash
corepack pnpm --filter anybox-chrome-browser-host build
```

The extension connects only through Chrome Native Messaging host
`com.anybox.browser`. Import and initialize the plugin Browser Client from the
general-purpose Node REPL before reconnecting the extension; the Browser Client
starts the plugin-owned Browser Host, installs the Native Host configuration,
and provisions its short-lived transport credential.

Browser-extension status and commands use authenticated local IPC owned by the
Chrome plugin. They are not AnyboxAgent HTTP routes and are not exposed directly
to extension pages or browser-origin HTTP requests.

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
