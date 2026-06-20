import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const pluginRoot = path.resolve(import.meta.dirname, "..");

describe("presentation scripts", () => {
  it("renders, checks, and builds the sample deck", async () => {
    const workspace = "workspaces/sample-basic";
    await execNode("scripts/render_slide.mjs", ["--workspace", workspace, "--slide", "slides/slide-01.mjs"]);
    await execNode("scripts/check_layout_quality.mjs", ["--workspace", workspace]);
    await execNode("scripts/build_deck.mjs", ["--workspace", workspace]);

    const pptx = path.resolve(pluginRoot, workspace, "output/final.pptx");
    const contactSheet = path.resolve(pluginRoot, workspace, "preview/contact-sheet.png");
    const layout = JSON.parse(await fs.readFile(path.resolve(pluginRoot, workspace, "layout/deck.json"), "utf8"));
    expect((await fs.stat(pptx)).size).toBeGreaterThan(0);
    expect((await fs.stat(contactSheet)).size).toBeGreaterThan(0);
    expect(layout.slides).toHaveLength(3);
  }, 60000);

  it("supports workspaces in the current project directory", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "presentation-project-"));
    const workspace = "workspaces/local-basic";
    const workspaceRoot = path.resolve(projectRoot, workspace);
    try {
      await fs.mkdir(path.resolve(workspaceRoot, "slides"), { recursive: true });
      await fs.writeFile(path.resolve(workspaceRoot, "slides/slide-01.mjs"), [
        "import { Layers, Text, Shape, composeSlide, textStyle, stroke } from \"@anybox/presentation-runtime\";",
        "",
        "export async function slide01(presentation) {",
        "  const slide = presentation.slides.add({ title: \"Local workspace\" });",
        "  composeSlide(slide, Layers({ width: 1280, height: 720 }, [",
        "    Shape({ fill: \"#FFFFFF\", line: stroke(\"none\"), position: { left: 0, top: 0 }, width: 1280, height: 720 }),",
        "    Text(\"Project-local workspace\", { role: \"title\", position: { left: 80, top: 80 }, width: 900, height: 80, style: textStyle(\"font: 44px Arial; weight: 700; color: #111827\") }),",
        "  ]));",
        "  return slide;",
        "}",
        "",
      ].join("\n"));

      await execNodeFrom(projectRoot, "scripts/render_slide.mjs", ["--workspace", workspace, "--slide", "slides/slide-01.mjs"]);
      await execNodeFrom(projectRoot, "scripts/check_layout_quality.mjs", ["--workspace", workspace]);
      await execNodeFrom(projectRoot, "scripts/build_deck.mjs", ["--workspace", workspace]);

      const pptx = path.resolve(workspaceRoot, "output/final.pptx");
      const contactSheet = path.resolve(workspaceRoot, "preview/contact-sheet.png");
      const layout = JSON.parse(await fs.readFile(path.resolve(workspaceRoot, "layout/deck.json"), "utf8"));
      expect((await fs.stat(pptx)).size).toBeGreaterThan(0);
      expect((await fs.stat(contactSheet)).size).toBeGreaterThan(0);
      expect(layout.slides).toHaveLength(1);
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  }, 60000);

  it("rejects non-whitelisted imports in slide modules", async () => {
    const workspaceRoot = path.resolve(pluginRoot, "workspaces", `.tmp-sandbox-${Date.now()}`);
    try {
      await fs.mkdir(path.resolve(workspaceRoot, "slides"), { recursive: true });
      await fs.writeFile(path.resolve(workspaceRoot, "slides/slide-01.mjs"), [
        'import fs from "node:fs";',
        "export async function slide01() { return fs; }",
        "",
      ].join("\n"));

      await expect(execNode("scripts/render_slide.mjs", [
        "--workspace",
        path.relative(pluginRoot, workspaceRoot),
        "--slide",
        "slides/slide-01.mjs",
      ])).rejects.toThrow(/Import not allowed/);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

async function execNode(script, args) {
  return execNodeFrom(pluginRoot, script, args);
}

async function execNodeFrom(cwd, script, args) {
  return execFileAsync(process.execPath, [path.resolve(pluginRoot, script), ...args], {
    cwd,
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 8,
  });
}
