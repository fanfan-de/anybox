import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  Image,
  Layers,
  Presentation,
  PresentationFile,
  Shape,
  Text,
  composeSlide,
  fill,
  stroke,
  textStyle,
} from "@anybox/presentation-runtime";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("presentation runtime", () => {
  it("creates stable layout elements from primitives", () => {
    const presentation = Presentation.create();
    const slide = presentation.slides.add();

    composeSlide(
      slide,
      Layers({ width: 1280, height: 720 }, [
        Shape({ position: { left: 0, top: 0 }, width: 1280, height: 720, fill: fill("#FFFFFF"), line: stroke("none") }),
        Text("Hello", {
          role: "title",
          position: { left: 80, top: 70 },
          width: 600,
          height: 80,
          style: textStyle("font: 44px Arial; weight: 700; color: #111827"),
        }),
        Image({ src: onePixelPng, position: { left: 80, top: 180 }, width: 160, height: 90 }),
      ]),
    );

    expect(slide.elements).toHaveLength(3);
    expect(slide.elements[1]).toMatchObject({
      type: "Text",
      text: "Hello",
      role: "title",
      left: 80,
      top: 70,
      width: 600,
      height: 80,
    });
    expect(slide.title).toBe("Hello");
  });

  it("exports editable pptx files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "presentations-runtime-"));
    const presentation = Presentation.create({ workspaceDir: dir });
    const slide = presentation.slides.add();
    composeSlide(
      slide,
      Layers({ width: 1280, height: 720 }, [
        Shape({ position: { left: 0, top: 0 }, width: 1280, height: 720, fill: "#FFFFFF", line: stroke("none") }),
        Text("Export Test", {
          role: "title",
          position: { left: 80, top: 80 },
          width: 700,
          height: 80,
          style: textStyle("font: 40px Arial; weight: 700; color: #111827"),
        }),
        Image({ src: onePixelPng, position: { left: 80, top: 190 }, width: 120, height: 80 }),
      ]),
    );

    const pptx = await PresentationFile.exportPptx(presentation);
    const output = path.join(dir, "test.pptx");
    await pptx.save(output);
    const stat = await fs.stat(output);
    expect(stat.size).toBeGreaterThan(0);
  });
});
