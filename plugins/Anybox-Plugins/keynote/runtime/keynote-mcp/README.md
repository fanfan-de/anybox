# Keynote MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![PyPI](https://img.shields.io/pypi/v/keynote-mcp.svg)](https://pypi.org/project/keynote-mcp/)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos/)

An MCP server that gives AI full control over Apple Keynote through AppleScript automation. Create, edit, and export presentations — all via natural language.

Ships with a **Claude Skill** that encodes layout rules, font workarounds, and design patterns so presentations come out right on the first try.

## Quick Start

### Prerequisites

- macOS 10.14+
- Keynote application installed
- Python 3.10+

### Option A: Install from PyPI

```bash
pip install keynote-mcp
```

Or run directly with `uvx` (no install needed):
```bash
uvx keynote-mcp
```

### Option B: Install from source

```bash
git clone https://github.com/ByAxe/keynote-mcp.git
cd keynote-mcp
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

### Register the MCP server

**Claude Code (PyPI install / uvx):**
```bash
claude mcp add keynote-mcp keynote-mcp
```

**Claude Code (from source):**
```bash
claude mcp add keynote-mcp "bash -c cd $(pwd) && .venv/bin/python -m keynote_mcp"
```

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "keynote-mcp": {
      "command": "keynote-mcp",
      "env": {
        "UNSPLASH_KEY": "your_key_here"
      }
    }
  }
}
```

Or if using `uvx`:
```json
{
  "mcpServers": {
    "keynote-mcp": {
      "command": "uvx",
      "args": ["keynote-mcp"],
      "env": {
        "UNSPLASH_KEY": "your_key_here"
      }
    }
  }
}
```

**Other MCP clients:**
- Command: `keynote-mcp` (if installed via pip) or `uvx keynote-mcp`
- Transport: stdio

### 3. Install the Skill (recommended)

The `keynote-presentation` skill teaches Claude how to use the MCP tools correctly — handling font clipping bugs, theme pitfalls, coordinate math, and design patterns.

**Claude Code** — copy the skill folder to your skills directory:
```bash
cp -r skills/keynote-presentation ~/.claude/skills/keynote-presentation
```

**Claude.ai:**
1. Zip the `skills/keynote-presentation` folder
2. Go to Settings > Capabilities > Skills
3. Click "Upload skill" and select the zip

### 4. macOS permissions

- System Settings > Privacy & Security > Accessibility — add Terminal/your IDE
- System Settings > Privacy & Security > Automation — allow Python to control Keynote

> **Security note:** Accessibility permissions are granted per-binary, not per-project. When you grant Accessibility access to `python`, all Python processes share that permission. Most keynote-mcp tools use plain AppleScript (no Accessibility needed) — only build animations require it. For stricter isolation, you can build a standalone binary (see [Standalone Binary](#standalone-binary) below) so keynote-mcp gets its own permission entry.

### 5. Use it

```
"Create a presentation about our Q1 results with 6 slides"
"Add a slide with a code example showing the API"
"Export the presentation as PDF"
```

## Available Tools (30+)

| Category | Tools |
|----------|-------|
| **Presentation** | create, open, save, close, list, themes, resolution, slide size |
| **Slides** | add, delete, duplicate, move, select, layouts, slide info |
| **Content** | text boxes (with font/color control), titles, subtitles, bullet lists, numbered lists, code blocks (with color), quotes, images, shapes (with opacity), edit, delete, move, resize elements, set element opacity, clear slide, speaker notes, build-in animations (add/remove via UI scripting) |
| **Export** | screenshot slides, export PDF |
| **Unsplash** | search images, add to slides, random images (requires `UNSPLASH_KEY`) |

## Unsplash Integration (optional)

```bash
cp env.example .env
# Add your key from https://unsplash.com/developers
# UNSPLASH_KEY=your_access_key
```

## About the Skill

The `keynote-presentation` skill (`skills/keynote-presentation/`) solves real problems discovered through production use:

- **Font clipping bug**: Large font sizes (>48pt) create tiny text boxes that clip text to 1-2 characters. The skill teaches Claude the resize-then-edit workaround.
- **Theme pitfalls**: Many themes (Gradient, Minimalist Dark) don't show backgrounds on Blank slides. The skill includes a tested compatibility table.
- **Coordinate math**: No text-align property exists. The skill provides per-character width estimates for manual centering.
- **Shape fill limitation**: Shape fill color is NOT writable via AppleScript. The skill documents the opacity workaround for dark-theme containers.
- **Dark theme color reference**: Tested RGB values for white text, gray subtitles, green code comments, and blue section headers.
- **Two-column layouts**: Proven coordinates for code-left/bullets-right slides using `add_shape` containers.
- **Design patterns**: Landing-page-style slide templates (hero, statement, bullets, code demo, closing) with tested positions.

### Skill structure

```
skills/keynote-presentation/
    SKILL.md                              # Main skill file with YAML frontmatter
    references/
        theme-reference.md                # Theme compatibility table
        coordinate-reference.md           # Layout math and centering formulas
```

## Project Structure

```
src/
  keynote_mcp/
    __init__.py            # Package version
    __main__.py            # python -m keynote_mcp entry point
    server.py              # MCP server — routes tool calls via stdio
    tools/
      presentation.py      # Presentation lifecycle tools
      slide.py             # Slide management tools
      content.py           # Content creation and editing tools
      export.py            # Screenshot and PDF export tools
      unsplash.py          # Unsplash image integration
    utils/
      applescript_runner.py # Executes AppleScript via osascript
      error_handler.py     # Exception hierarchy and validation
    applescript/           # AppleScript source files
skills/                    # Claude Skills for this MCP
tests/                     # Test scaffolding
```

## Standalone Binary

For security-conscious users who don't want to grant Accessibility permissions to the shared `python` binary, you can build keynote-mcp as a standalone executable with its own permission entry:

```bash
# Install pyinstaller
pip install pyinstaller

# Build standalone binary (~31MB)
pyinstaller --onefile --name keynote-mcp src/keynote_mcp/__main__.py

# Code-sign so macOS tracks it as its own app
codesign -s - -f dist/keynote-mcp
```

Then use the binary in your MCP config:
```json
{
  "mcpServers": {
    "keynote-mcp": {
      "command": "/absolute/path/to/dist/keynote-mcp"
    }
  }
}
```

When you grant Accessibility permission, it will appear as "keynote-mcp" instead of "Python".

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) — standardized tool protocol for AI
- [Unsplash](https://unsplash.com/) — free high-quality images
- [AppleScript](https://developer.apple.com/documentation/applescript) — macOS automation
- Original project by [easychen](https://github.com/easychen/keynote-mcp)
