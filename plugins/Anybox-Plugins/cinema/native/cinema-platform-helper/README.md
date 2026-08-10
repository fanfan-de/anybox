# cinema-platform-helper

This helper is the Cinema plugin's only native boundary. It accepts one JSON request on stdin and emits one JSON response on stdout. Supported methods are:

- `credential.get`, `credential.set`, and `credential.delete` for the fixed `com.anybox.cinema` service.
- `dialog.pickDirectory` for project selection.
- `dialog.pickFile` for offline toolchain archive selection.

Secrets are sent only between the plugin runtime and the operating-system credential store. They are never logged or persisted by the helper.
