#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_NAME="latex"

timestamp="$(date +"%Y%m%d-%H%M%S")"
default_out_dir="${TMPDIR:-/tmp}/${PLUGIN_NAME}-bundle-${timestamp}"
OUT_DIR="${1:-${default_out_dir}}"
ZIP_PATH="${2:-${OUT_DIR}.zip}"
git_sha="$(git -C "${PLUGIN_DIR}" rev-parse --short=12 HEAD 2>/dev/null || printf 'unknown')"

if [ -e "${OUT_DIR}" ] && [ -n "$(ls -A "${OUT_DIR}" 2>/dev/null)" ]; then
  echo "Refusing to write into non-empty directory: ${OUT_DIR}" >&2
  exit 1
fi

if [ -e "${ZIP_PATH}" ]; then
  echo "Refusing to overwrite existing archive: ${ZIP_PATH}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}/plugins" "${OUT_DIR}/.agents/plugins"
cp -R "${PLUGIN_DIR}" "${OUT_DIR}/plugins/${PLUGIN_NAME}"

find "${OUT_DIR}/plugins/${PLUGIN_NAME}" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "${OUT_DIR}/plugins/${PLUGIN_NAME}" -type f \( -name '*.pyc' -o -name '.DS_Store' \) -delete

cat > "${OUT_DIR}/.agents/plugins/marketplace.json" <<JSON
{
  "name": "local-latex",
  "interface": {
    "displayName": "Local LaTeX"
  },
  "plugins": [
    {
      "name": "${PLUGIN_NAME}",
      "source": {
        "source": "local",
        "path": "./plugins/${PLUGIN_NAME}"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Research"
    }
  ]
}
JSON

cat > "${OUT_DIR}/install.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="latex"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
MARKETPLACE_NAME="local-latex"
PLUGIN_KEY="${PLUGIN_NAME}@${MARKETPLACE_NAME}"
MARKETPLACE_FILE="${SCRIPT_DIR}/.agents/plugins/marketplace.json"
PLUGIN_MANIFEST="${SCRIPT_DIR}/plugins/${PLUGIN_NAME}/.codex-plugin/plugin.json"

if [ ! -f "${MARKETPLACE_FILE}" ]; then
  echo "Missing Codex marketplace manifest: ${MARKETPLACE_FILE}" >&2
  exit 1
fi
if [ ! -f "${PLUGIN_MANIFEST}" ]; then
  echo "Missing Codex plugin manifest: ${PLUGIN_MANIFEST}" >&2
  exit 1
fi

if [ -n "${CODEX_BIN:-}" ]; then
  codex_bin="${CODEX_BIN}"
elif command -v codex >/dev/null 2>&1; then
  codex_bin="$(command -v codex)"
elif [ -x "/Applications/Codex.app/Contents/Resources/codex" ]; then
  codex_bin="/Applications/Codex.app/Contents/Resources/codex"
else
  echo "Could not find the Codex CLI. Set CODEX_BIN=/path/to/codex and rerun." >&2
  exit 1
fi

"${codex_bin}" plugin marketplace add "${SCRIPT_DIR}"

plugin_version="$(python3 - "${PLUGIN_MANIFEST}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["version"])
PY
)"
cache_plugin_dir="${CODEX_HOME}/plugins/cache/${MARKETPLACE_NAME}/${PLUGIN_NAME}/${plugin_version}"
rm -rf "${cache_plugin_dir}"
mkdir -p "$(dirname "${cache_plugin_dir}")"
cp -R "${SCRIPT_DIR}/plugins/${PLUGIN_NAME}" "${cache_plugin_dir}"

python3 - "${CODEX_HOME}/config.toml" "${PLUGIN_KEY}" <<'PY'
from __future__ import annotations

import sys
from pathlib import Path

config_path = Path(sys.argv[1])
plugin_key = sys.argv[2]

text = config_path.read_text() if config_path.exists() else ""
lines = text.splitlines()


def set_table_key(
    input_lines: list[str],
    *,
    header: str,
    key: str,
    value: str,
) -> list[str]:
    out: list[str] = []
    inside_target = False
    seen_target = False
    target_has_key = False

    for line in input_lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            if inside_target and not target_has_key:
                out.append(f"{key} = {value}")
            inside_target = stripped == header
            if inside_target:
                seen_target = True
                target_has_key = False

        is_target_key = False
        if inside_target and "=" in stripped:
            is_target_key = stripped.split("=", 1)[0].strip() == key

        if is_target_key:
            out.append(f"{key} = {value}")
            target_has_key = True
        else:
            out.append(line)

    if inside_target and not target_has_key:
        out.append(f"{key} = {value}")

    if not seen_target:
        if out and out[-1] != "":
            out.append("")
        out.extend([header, f"{key} = {value}"])

    return out


lines = set_table_key(lines, header="[features]", key="plugins", value="true")
lines = set_table_key(
    lines,
    header=f'[plugins."{plugin_key}"]',
    key="enabled",
    value="true",
)

config_path.parent.mkdir(parents=True, exist_ok=True)
config_path.write_text("\n".join(lines).rstrip() + "\n")
PY

cat <<EOF
Installed the ${PLUGIN_NAME} local plugin bundle.

Marketplace source: ${SCRIPT_DIR}
Codex CLI:          ${codex_bin}
Plugin cache:       ${cache_plugin_dir}

Next steps:
1. Restart Codex if it is already open.
2. Start a new thread before testing the plugin skills.
EOF
SH
chmod +x "${OUT_DIR}/install.sh"

cat > "${OUT_DIR}/uninstall.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="latex"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
MARKETPLACE_NAME="local-latex"
PLUGIN_KEY="${PLUGIN_NAME}@${MARKETPLACE_NAME}"
CACHE_PLUGIN_PARENT="${CODEX_HOME}/plugins/cache/${MARKETPLACE_NAME}/${PLUGIN_NAME}"

rm -rf "${CACHE_PLUGIN_PARENT}"

if [ -n "${CODEX_BIN:-}" ]; then
  codex_bin="${CODEX_BIN}"
elif command -v codex >/dev/null 2>&1; then
  codex_bin="$(command -v codex)"
elif [ -x "/Applications/Codex.app/Contents/Resources/codex" ]; then
  codex_bin="/Applications/Codex.app/Contents/Resources/codex"
else
  codex_bin=""
fi

python3 - "${CODEX_HOME}/config.toml" "${PLUGIN_KEY}" <<'PY'
from __future__ import annotations

import sys
from pathlib import Path

config_path = Path(sys.argv[1])
plugin_key = sys.argv[2]
if not config_path.exists():
    raise SystemExit(0)

header = f'[plugins."{plugin_key}"]'
lines = config_path.read_text().splitlines()
out: list[str] = []
skip_block = False

for line in lines:
    stripped = line.strip()
    starts_header = stripped.startswith("[") and stripped.endswith("]")
    if starts_header:
        skip_block = stripped == header
    if not skip_block:
        out.append(line)

config_path.write_text("\n".join(out).rstrip() + "\n")
PY

if [ -n "${codex_bin}" ]; then
  "${codex_bin}" plugin marketplace remove "${MARKETPLACE_NAME}" >/dev/null 2>&1 || true
fi

cat <<EOF
Removed the ${PLUGIN_NAME} local plugin bundle.

Restart Codex if it is open.
EOF
SH
chmod +x "${OUT_DIR}/uninstall.sh"

cat > "${OUT_DIR}/README.md" <<MD
# LaTeX Local Plugin Bundle

Build timestamp: ${timestamp}
Source commit: ${git_sha}

## Install

1. Unzip this bundle.
2. Run \`./install.sh\`.
3. Restart Codex if it is already open.
4. Start a new thread before testing.

## What The Installer Does

- Registers this directory as a local Codex marketplace with \`codex plugin marketplace add\`.
- Copies the plugin into \`~/.codex/plugins/cache/local-latex/latex/<version>\`.
- Ensures \`[features] plugins = true\` is set in \`~/.codex/config.toml\`.
- Enables \`latex@local-latex\` in \`~/.codex/config.toml\`.
- Does not install TeX Live. TeX Live installation remains an explicit skill action. Bundled Tectonic is present only in Codex Desktop packaged builds.

## Test Prompt

\`\`\`text
Use latex-doctor to check this machine's LaTeX setup.
\`\`\`

## Uninstall

Run \`./uninstall.sh\`.
MD

(
  cd "$(dirname "${OUT_DIR}")"
  zip -qr "${ZIP_PATH}" "$(basename "${OUT_DIR}")"
)

printf 'Bundle directory: %s\n' "${OUT_DIR}"
printf 'Zip archive: %s\n' "${ZIP_PATH}"
