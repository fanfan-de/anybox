#!/bin/sh

set -eu

platform_name=$(uname -s 2>/dev/null || true)
if [ "$platform_name" != "Darwin" ]; then
  echo "Keynote Studio requires macOS; detected ${platform_name:-unknown}." >&2
  exit 64
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
project_root="$plugin_root/runtime/keynote-mcp"

if [ ! -f "$project_root/pyproject.toml" ] || [ ! -f "$project_root/uv.lock" ]; then
  echo "Keynote Studio runtime is incomplete: expected pyproject.toml and uv.lock under $project_root." >&2
  exit 66
fi

uv_command=""
configured_uv=${KEYNOTE_UV_PATH:-}

if [ -n "$configured_uv" ]; then
  if [ -x "$configured_uv" ]; then
    uv_command=$configured_uv
  elif command -v "$configured_uv" >/dev/null 2>&1; then
    uv_command=$(command -v "$configured_uv")
  else
    echo "Configured uv executable was not found or is not executable: $configured_uv" >&2
    exit 69
  fi
else
  if command -v uv >/dev/null 2>&1; then
    uv_command=$(command -v uv)
  else
    for uv_candidate in \
      "${HOME:-}/.local/bin/uv" \
      "/opt/homebrew/bin/uv" \
      "/usr/local/bin/uv"
    do
      if [ -n "$uv_candidate" ] && [ -x "$uv_candidate" ]; then
        uv_command=$uv_candidate
        break
      fi
    done
  fi
fi

if [ -z "$uv_command" ]; then
  echo "Keynote Studio requires uv. Install it from https://docs.astral.sh/uv/getting-started/installation/ and restart Anybox, or configure KEYNOTE_UV_PATH." >&2
  exit 69
fi

if [ -n "${XDG_CACHE_HOME:-}" ]; then
  cache_root=$XDG_CACHE_HOME
elif [ -n "${HOME:-}" ]; then
  cache_root="$HOME/Library/Caches"
else
  cache_root=${TMPDIR:-/tmp}
fi

runtime_environment="$cache_root/Anybox/keynote-mcp/1.0.1"
export UV_PROJECT_ENVIRONMENT="$runtime_environment"
export PYTHONUNBUFFERED=1
export PYTHONDONTWRITEBYTECODE=1

exec "$uv_command" run \
  --project "$project_root" \
  --frozen \
  --no-dev \
  --no-editable \
  --python 3.12 \
  keynote-mcp
