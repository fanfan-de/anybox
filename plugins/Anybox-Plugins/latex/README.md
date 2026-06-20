# LaTeX Plugin

This plugin provides local LaTeX workflows for Codex users:

- `latex-doctor`: detect Tectonic plus TeX Live or MacTeX, then run compile smoke tests when possible.
- `latex-compile`: compile a TeX project in `auto` mode, trying Tectonic first for simple projects and falling back to TeX Live when needed.
- `texlive-runtime-installer`: detect-first installer for an optional Codex-managed full TeX Live runtime.

The compile helper uses a conservative heuristic before trying Tectonic: simple standalone projects go through Tectonic first, while projects that declare bibliography, shell-escape, index/glossary, or explicit non-Tectonic engine requirements go directly to TeX Live.

The installer is intentionally conservative. It does not install managed TeX Live when an existing TeX Live or MacTeX installation is detected. A full managed install only runs when the detector reports `missing`, or when explicitly forced.

## Managed Runtime

The managed full runtime installs under:

```text
~/.cache/codex-runtimes/codex-texlive/full
```

The installer does not use `sudo`, does not write `/Library/TeX`, does not write `/usr/local/texlive`, and does not edit the user's shell startup files. Codex compile helpers prepend the detected TeX bin directory only for the command they run.
