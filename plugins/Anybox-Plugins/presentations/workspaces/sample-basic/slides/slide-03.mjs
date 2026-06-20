import {
  Layers,
  Text,
  Shape,
  Column,
  composeSlide,
  textStyle,
  stroke,
} from "@anybox/presentation-runtime";

export async function slide03(presentation, ctx) {
  const slide = presentation.slides.add({ title: "Quality gates" });

  composeSlide(
    slide,
    Layers({ width: 1280, height: 720 }, [
      Shape({
        fill: "#101828",
        line: stroke("none"),
        position: { left: 0, top: 0 },
        width: 1280,
        height: 720,
      }),
      Shape({
        fill: "#6D5EF5",
        line: stroke("none"),
        radius: 24,
        position: { left: 816, top: 88 },
        width: 312,
        height: 448,
      }),
      Text("Quality gates", {
        role: "title",
        position: { left: 78, top: 72 },
        width: 620,
        height: 64,
        style: textStyle("font: 40px Arial; weight: 700; color: #FFFFFF"),
      }),
      Text("The checker keeps obvious layout failures out of the final artifact.", {
        position: { left: 80, top: 152 },
        width: 610,
        height: 70,
        style: textStyle("font: 22px Arial; color: #D0D5DD; line-height: 30px"),
      }),
      Column({ position: { left: 84, top: 286 }, width: 620, height: 260, gap: 18 }, [
        Text("Canvas bounds", {
          height: 38,
          style: textStyle("font: 24px Arial; weight: 700; color: #FFFFFF"),
        }),
        Text("Missing titles", {
          height: 38,
          style: textStyle("font: 24px Arial; weight: 700; color: #FFFFFF"),
        }),
        Text("Text overflow", {
          height: 38,
          style: textStyle("font: 24px Arial; weight: 700; color: #FFFFFF"),
        }),
        Text("Image paths", {
          height: 38,
          style: textStyle("font: 24px Arial; weight: 700; color: #FFFFFF"),
        }),
      ]),
      Text("QA", {
        position: { left: 872, top: 150 },
        width: 200,
        height: 100,
        style: textStyle("font: 76px Arial; weight: 700; color: #FFFFFF"),
      }),
      Text("layout.json + PNG preview + final.pptx", {
        position: { left: 862, top: 296 },
        width: 220,
        height: 100,
        style: textStyle("font: 26px Arial; weight: 700; color: #FFFFFF; line-height: 34px"),
      }),
    ]),
  );

  return slide;
}
