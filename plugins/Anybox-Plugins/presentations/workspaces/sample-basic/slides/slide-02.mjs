import {
  Layers,
  Text,
  Shape,
  Panel,
  Row,
  composeSlide,
  textStyle,
  stroke,
} from "@anybox/presentation-runtime";

export async function slide02(presentation, ctx) {
  const slide = presentation.slides.add({ title: "Build loop" });

  composeSlide(
    slide,
    Layers({ width: 1280, height: 720 }, [
      Shape({
        fill: "#FFFFFF",
        line: stroke("none"),
        position: { left: 0, top: 0 },
        width: 1280,
        height: 720,
      }),
      Text("Build loop", {
        role: "title",
        position: { left: 72, top: 58 },
        width: 760,
        height: 60,
        style: textStyle("font: 40px Arial; weight: 700; color: #111827"),
      }),
      Row({ position: { left: 72, top: 176 }, width: 1136, height: 276, gap: 28 }, [
        Panel({ fill: "#F0F7FF", line: stroke("#BBD7FF"), radius: 14, padding: 24 }, [
          Text("1", {
            position: { left: 0, top: 0 },
            width: 60,
            height: 64,
            style: textStyle("font: 48px Arial; weight: 700; color: #2563EB"),
          }),
          Text("Write modules", {
            position: { left: 0, top: 86 },
            width: 290,
            height: 34,
            style: textStyle("font: 22px Arial; weight: 700; color: #111827"),
          }),
          Text("One deterministic ESM file per slide.", {
            position: { left: 0, top: 132 },
            width: 290,
            height: 72,
            style: textStyle("font: 18px Arial; color: #374151; line-height: 26px"),
          }),
        ]),
        Panel({ fill: "#F8F4FF", line: stroke("#D8C7FF"), radius: 14, padding: 24 }, [
          Text("2", {
            position: { left: 0, top: 0 },
            width: 60,
            height: 64,
            style: textStyle("font: 48px Arial; weight: 700; color: #6D5EF5"),
          }),
          Text("Render preview", {
            position: { left: 0, top: 86 },
            width: 290,
            height: 34,
            style: textStyle("font: 22px Arial; weight: 700; color: #111827"),
          }),
          Text("SVG and PNG reveal visual problems early.", {
            position: { left: 0, top: 132 },
            width: 290,
            height: 72,
            style: textStyle("font: 18px Arial; color: #374151; line-height: 26px"),
          }),
        ]),
        Panel({ fill: "#EEFDF5", line: stroke("#B7E8C9"), radius: 14, padding: 24 }, [
          Text("3", {
            position: { left: 0, top: 0 },
            width: 60,
            height: 64,
            style: textStyle("font: 48px Arial; weight: 700; color: #0F9F6E"),
          }),
          Text("Build PPTX", {
            position: { left: 0, top: 86 },
            width: 290,
            height: 34,
            style: textStyle("font: 22px Arial; weight: 700; color: #111827"),
          }),
          Text("Final output remains editable in PowerPoint.", {
            position: { left: 0, top: 132 },
            width: 290,
            height: 72,
            style: textStyle("font: 18px Arial; color: #374151; line-height: 26px"),
          }),
        ]),
      ]),
      Text("The Agent iterates on code; the plugin controls execution and evidence.", {
        position: { left: 72, top: 548 },
        width: 980,
        height: 36,
        style: textStyle("font: 22px Arial; color: #374151"),
      }),
    ]),
  );

  return slide;
}
