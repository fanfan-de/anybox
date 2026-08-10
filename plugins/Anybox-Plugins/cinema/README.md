# Cinema Runtime 1.0

Cinema is a self-contained Anybox App Plugin. It owns its Web application, HTTP API, contracts, domain and storage code, project registry, migrations, providers, credentials, media toolchain, native helper, and MCP server. It does not import Anybox Agent Cinema code or Shared Cinema contracts.

## Package layout

```text
.anybox-plugin/plugin.json   App/MCP/permission/artifact manifest
src/web/                     React application
src/contracts/               persisted and HTTP contracts
src/api/                     Hono API and legacy /api/cinema envelopes
src/domain/                  canvas, assets, generation, timeline, render
src/storage/                 settings, projects, atomic writes, lease locks
src/providers/               provider adapters and network policy
src/platform/                keychain/helper/toolchain integration
src/migrations/              Runtime v1 project migration
src/mcp/                     MCP server using the same storage/domain code
native/                      Rust helper and per-platform artifact assembly
toolchain/                   pinned FFmpeg recipes, notices, and validation
web/, runtime/, mcp/         only JavaScript build outputs shipped in the ZIP
```

## Run and build

From this directory:

```powershell
bun run typecheck
bun run test
bun run build
bun runtime/server.js --standalone
```

Standalone mode binds only `127.0.0.1`, chooses a random port by default, and prints one bootstrap URL. The one-time token is exchanged for an `HttpOnly`, `SameSite=Strict` session cookie and the browser is redirected to a token-free URL. Mutations require a same-origin request and CSRF token.

In Anybox mode the generic supervisor supplies only:

```text
ANYBOX_APP_ID, ANYBOX_APP_VERSION, ANYBOX_APP_PORT, ANYBOX_APP_TOKEN,
ANYBOX_APP_DATA_DIR, ANYBOX_APP_CACHE_DIR, ANYBOX_APP_LOG_DIR,
ANYBOX_APP_LOCALE, ANYBOX_APP_ARTIFACTS_JSON
```

The Runtime accepts only the Gateway token. Both modes execute the same API, providers, storage, generation, and Deliver implementation.

## Data and project ownership

Plugin state is stored beneath `ANYBOX_APP_DATA_DIR`; cache and logs use their dedicated App Runtime directories. Project contents remain in user-selected folders and are identified by `.anybox-cinema/project.json.id` (`cin_<uuid>` for a new or invalid ID).

Moving a project preserves its ID. Opening two valid directories with the same ID is blocked until the selected copy is explicitly cloned to a new ID. Runtime v1 migration creates `.anybox-cinema/backups/runtime-v1-<timestamp>/`, atomically rewrites current JSON documents, appends a JSONL mapping event, records an idempotent marker, and rolls back all changes on failure. Old global credentials, presets, and personal media are never imported.

Runtime and MCP mutations share atomic writes, revisions, command idempotency, and cross-process lease locks beneath the project metadata directory.

## Providers, credentials, and Deliver

Cinema 1.0 supports exactly `klingai-cn`, `google-ai-sdk`, `comfyui-local`, and `openai-compatible`. Provider URLs must use HTTPS, except explicit loopback HTTP. DNS/private-network checks and same-origin redirect rules are enforced by the Runtime.

The Rust `cinema-platform-helper` exposes a line-delimited JSON-RPC protocol for OS-keychain access and user-initiated file or directory selection. Credentials use the fixed service `com.anybox.cinema`; API responses expose configuration state only. If a keychain is unavailable, the user must explicitly choose a process-memory-only credential.

FFmpeg is not included in the plugin ZIP and is never resolved from `PATH`. Deliver installs or imports the pinned archive into the plugin data directory only after validating the archive and each internal file digest. Installation supports cancellation and byte-range resume.

## Verification and release

```powershell
bun run check:decoupling
bun run test:toolchain
bun run package
bun run package:smoke
bun run package:playwright-smoke
```

`package` builds a local package for the current declared helper set. Production assembly requires signed and reviewed helpers for Windows x64, macOS arm64, and Linux x64. Run `helper:verify-signature` on each native platform first (Authenticode, Apple codesign, or a detached Linux minisign signature), aggregate the three artifact directories, then run:

```powershell
bun run helpers:assemble
bun run package:release
```

The GitHub matrix workflow is validation-only. It does not publish a production release. Production signing and publication remain under the repository's local release authority.
