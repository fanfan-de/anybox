import {
  Layers,
  Text,
  Shape,
  composeSlide,
  textStyle,
  stroke,
} from "@anybox/presentation-runtime";

export async function slide01(presentation, ctx) {
  const slide = presentation.slides.add({ title: "Code-first presentations" });

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
      Shape({
        fill: "#6D5EF5",
        line: stroke("none"),
        position: { left: 0, top: 0 },
        width: 24,
        height: 720,
      }),
      Text("Code-first presentations", {
        role: "title",
        position: { left: 88, top: 86 },
        width: 840,
        height: 72,
        style: textStyle("font: 44px Arial; weight: 700; color: #17202A"),
      }),
      Text("Executable slide modules, editable PPTX output, and a render/QA loop that catches layout mistakes before delivery.", {
        position: { left: 90, top: 184 },
        width: 790,
        height: 92,
        style: textStyle("font: 23px Arial; color: #374151; line-height: 32px"),
      }),
      Shape({
        fill: "#FFFFFF",
        line: stroke("#D8D4C8", { width: 1 }),
        radius: 16,
        position: { left: 90, top: 350 },
        width: 490,
        height: 160,
      }),
      Text("V1 shape", {
        position: { left: 122, top: 382 },
        width: 420,
        height: 32,
        style: textStyle("font: 18px Arial; weight: 700; color: #6D5EF5"),
      }),
      Text("Agent writes .mjs slides. The plugin owns rendering, QA, and export.", {
        position: { left: 122, top: 428 },
        width: 410,
        height: 52,
        style: textStyle("font: 20px Arial; color: #17202A; line-height: 28px"),
      }),
    ]),
  );

  return slide;
}
