#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, printJson, requireArg, resolveProjectPath } from "./lib/cli.mjs";
import { checkLayoutQuality, summarizeQuality } from "./lib/quality.mjs";

try {
  const args = parseArgs();
  let layoutPath;
  let workspaceDir = null;
  if (args.layout) {
    layoutPath = resolveProjectPath(String(args.layout));
    workspaceDir = args.workspace ? resolveProjectPath(String(args.workspace)) : path.dirname(path.dirname(layoutPath));
  } else {
    workspaceDir = resolveProjectPath(requireArg(args, "workspace"));
    layoutPath = await findWorkspaceLayout(workspaceDir);
  }

  const layout = JSON.parse(await fs.readFile(layoutPath, "utf8"));
  const report = await checkLayoutQuality(layout, { workspaceDir });
  const outputPath = workspaceDir ? path.resolve(workspaceDir, "layout", "quality-report.json") : null;
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  printJson({
    summary: summarizeQuality(report),
    reportPath: outputPath,
    ...report,
  });
  if (!report.ok) process.exit(2);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function findWorkspaceLayout(workspaceDir) {
  const deck = path.resolve(workspaceDir, "layout", "deck.json");
  try {
    await fs.access(deck);
    return deck;
  } catch {
    // Continue below.
  }
  const layoutDir = path.resolve(workspaceDir, "layout");
  const files = (await fs.readdir(layoutDir)).filter((name) => /^slide-\d+\.json$/.test(name)).sort();
  if (files.length === 0) {
    throw new Error(`No layout JSON found in ${layoutDir}. Run render_slide or build_deck first.`);
  }
  return path.resolve(layoutDir, files[0]);
}
