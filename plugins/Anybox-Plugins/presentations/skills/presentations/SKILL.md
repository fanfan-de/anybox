---
name: "Presentations"
description: "Create editable PowerPoint `.pptx` decks locally with code-first slide modules, PNG previews, layout JSON, and strict layout QA. Use when the user wants a durable presentation, slide deck, PPT, PPTX, or PowerPoint artifact."
---

# Presentations Skill

Use this skill when the durable output should be an editable PowerPoint `.pptx` file.

## Contract

- Use only `@anybox/presentation-runtime` from this plugin. Do not import `pptxgenjs` or other presentation libraries directly.
- Create one ESM module per slide under `workspaces/<task-id>/slides/`.
- Each slide module must export `slideXX(presentation, ctx)`, where `XX` matches the filename, for example `slide-01.mjs` exports `slide01`.
- Slide modules may create a slide with `presentation.slides.add()` and call `composeSlide(slide, elementTree)`.
- Use editable primitives: `Text`, `Shape`, `Image`, `Layers`, `Panel`, `Row`, and `Column`.
- Do not export PPTX directly from slide modules. Rendering, QA, and export are controlled by the plugin scripts.
- Keep assets under `workspaces/<task-id>/assets/`. Use `ctx.assetPath("name.png")` for local assets.

## Required Workflow

1. Draft or update slide modules in `workspaces/<task-id>/slides/`.
2. Run plugin scripts from the active project directory. If the script files are not present in the project, call the installed plugin script with an absolute path; `--workspace workspaces/<task-id>` is resolved relative to the current project directory.
3. Render each changed slide:

```bash
node scripts/render_slide.mjs --workspace workspaces/<task-id> --slide slides/slide-01.mjs
```

4. Run layout QA:

```bash
node scripts/check_layout_quality.mjs --workspace workspaces/<task-id>
```

5. Build the deck only after previews and QA pass:

```bash
node scripts/build_deck.mjs --workspace workspaces/<task-id>
```

6. Deliver only `workspaces/<task-id>/output/final.pptx` unless the user explicitly asks for previews or QA artifacts.

## Sandbox Notes

Slide modules run in a practical child-process sandbox with an import whitelist, workspace path checks, output directory controls, and timeouts. This is not a strong security boundary. Do not write shell commands, read home directories, read secrets, access the network, or perform side effects in slide modules.

Allowed slide module import:

```js
import {
  Presentation,
  Layers,
  Text,
  Shape,
  Panel,
  Row,
  Column,
  Image,
  composeSlide,
  textStyle,
  stroke,
  fill,
} from "@anybox/presentation-runtime";
```

## Slide Module Example

```js
import {
  Layers,
  Text,
  Shape,
  composeSlide,
  textStyle,
  stroke,
} from "@anybox/presentation-runtime";

export async function slide01(presentation, ctx) {
  const slide = presentation.slides.add();

  composeSlide(
    slide,
    Layers({ width: 1280, height: 720 }, [
      Shape({
        fill: "#F7F4ED",
        line: stroke("none"),
        position: { left: 0, top: 0 },
        width: 1280,
        height: 720,
      }),
      Text("Quarterly Review", {
        role: "title",
        position: { left: 80, top: 80 },
        width: 900,
        height: 70,
        style: textStyle("font: 44px Arial; weight: 700; color: #17202A"),
      }),
    ]),
  );

  return slide;
}
```

## Quality Gates

Before final delivery, confirm:

- `output/final.pptx` exists and is non-empty.
- `layout/deck.json` exists and slide count matches the requested deck.
- PNG previews are not blank.
- No elements exceed the canvas.
- Text boxes have no obvious overflow warnings left unresolved.
- Images resolve to existing files or valid data URIs.
- Every slide has a visible title.
- `preview/contact-sheet.png` exists for deck-level review.

If LibreOffice is unavailable, the build falls back to SVG/PNG/layout QA and records `loFinalRenderSkipped` in the build summary.
