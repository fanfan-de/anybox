# LaTeX Plugin Dependencies

| Skill | Required | Optional | Notes |
| --- | --- | --- | --- |
| `latex-doctor` | Python 3 | Bundled or PATH `tectonic`; existing `latexmk`, `pdflatex`, `xelatex`, `lualatex`, `biber`, `kpsewhich` | Reports available runtimes and runs small compile smoke tests when possible. |
| `latex-compile` | Python 3; bundled or PATH `tectonic`, or a TeX engine such as `pdflatex` | `latexmk`, `xelatex`, `lualatex`, SyncTeX support from the TeX distribution | `auto` mode tries Tectonic for simple projects before falling back to detected TeX Live tooling. |
| `texlive-runtime-installer` | Python 3 | `perl`; network access to CTAN when running `--install-managed-full` | Default mode is detect-only. Managed full install is explicit and user-scoped under `~/.cache/codex-runtimes`. |

No connector apps or plugin-local MCP servers are required.
