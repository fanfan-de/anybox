import { describe, expect, it } from "vitest";
import { checkLayoutQuality } from "../scripts/lib/quality.mjs";

describe("layout quality checker", () => {
  it("detects blank slides and missing titles", async () => {
    const report = await checkLayoutQuality({
      slideSize: { width: 1280, height: 720 },
      slides: [
        {
          id: "slide-01",
          slideSize: { width: 1280, height: 720 },
          elements: [],
        },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.errors.map((error) => error.code)).toContain("blank-slide");
    expect(report.errors.map((error) => error.code)).toContain("missing-title");
  });

  it("warns on likely text overflow and errors on out-of-bounds content", async () => {
    const report = await checkLayoutQuality({
      slideSize: { width: 1280, height: 720 },
      slides: [
        {
          id: "slide-01",
          slideSize: { width: 1280, height: 720 },
          elements: [
            {
              id: "title",
              type: "Text",
              role: "title",
              text: "Title",
              left: 80,
              top: 80,
              width: 500,
              height: 60,
              style: { fontSize: 36, lineHeight: 44 },
            },
            {
              id: "body",
              type: "Text",
              text: "This is a very long paragraph that should overflow a tiny text box and produce a warning for the agent to fix.",
              left: 80,
              top: 180,
              width: 160,
              height: 24,
              style: { fontSize: 18, lineHeight: 24 },
            },
            {
              id: "bad-shape",
              type: "Shape",
              left: 1250,
              top: 100,
              width: 100,
              height: 100,
              fill: { color: "#FFFFFF" },
              line: { color: "none" },
            },
          ],
        },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.errors.map((error) => error.code)).toContain("out-of-bounds");
    expect(report.warnings.map((warning) => warning.code)).toContain("text-overflow");
  });

  it("detects missing image paths", async () => {
    const report = await checkLayoutQuality({
      slideSize: { width: 1280, height: 720 },
      slides: [
        {
          id: "slide-01",
          slideSize: { width: 1280, height: 720 },
          elements: [
            {
              id: "title",
              type: "Text",
              role: "title",
              text: "Title",
              left: 80,
              top: 80,
              width: 500,
              height: 60,
              style: { fontSize: 36, lineHeight: 44 },
            },
            {
              id: "missing",
              type: "Image",
              src: "does-not-exist.png",
              left: 80,
              top: 180,
              width: 300,
              height: 200,
            },
          ],
        },
      ],
    }, { workspaceDir: process.cwd() });

    expect(report.ok).toBe(false);
    expect(report.errors.map((error) => error.code)).toContain("image-not-found");
  });
});
