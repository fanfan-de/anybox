---
name: latex-compile
description: Compile a TeX project from Codex, trying bundled Tectonic for simple projects and falling back to detected TeX Live or MacTeX when needed.
---

# LaTeX Compile

Use this skill when the user asks to build, render, regenerate, or compile a `.tex` file.

Run from the plugin root:

```bash
python3 scripts/compile_latex.py /absolute/path/to/main.tex
```

Default `auto` mode uses Tectonic first only when the project looks simple enough not to need a full TeX Live toolchain. It falls back to TeX Live or MacTeX when Tectonic fails or when the project uses bibliography, shell-escape, index/glossary, or explicit non-Tectonic engine features.

Common options:

```bash
python3 scripts/compile_latex.py /absolute/path/to/main.tex --compiler tectonic
python3 scripts/compile_latex.py /absolute/path/to/main.tex --compiler texlive
python3 scripts/compile_latex.py /absolute/path/to/main.tex --engine xelatex
python3 scripts/compile_latex.py /absolute/path/to/main.tex --output-directory /absolute/path/to/build
python3 scripts/compile_latex.py /absolute/path/to/main.tex --json
```

## Behavior

- Detects bundled or PATH Tectonic and existing TeX Live or MacTeX.
- Honors a leading `% !TEX root = ...` directive when present.
- Uses `latexmk` for TeX Live builds when available.
- Enables SyncTeX with `-synctex=1` for TeX Live builds.
- Does not install TeX.

If neither Tectonic nor a usable TeX installation is found, stop and route to `latex-doctor` or `texlive-runtime-installer`.
