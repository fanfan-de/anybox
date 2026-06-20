#!/usr/bin/env node
import {
  parseArgs,
  pluginRootFrom,
  printJson,
  requireArg,
  asNumber,
  projectWorkspacesRoot,
  resolveProjectPath,
} from "./lib/cli.mjs";
import { runWorker } from "./lib/sandbox.mjs";

const pluginRoot = pluginRootFrom(import.meta.url);

try {
  const args = parseArgs();
  const projectRoot = process.cwd();
  const workspace = resolveProjectPath(requireArg(args, "workspace"), projectRoot);
  const slide = requireArg(args, "slide");
  const exportName = args.export ? String(args.export) : undefined;
  const timeoutMs = asNumber(args.timeoutMs, 15000);
  const result = await runWorker("render-slide", {
    pluginRoot,
    workspacesRoot: projectWorkspacesRoot(projectRoot),
    workspaceDir: workspace,
    slidePath: slide,
    exportName,
  }, { pluginRoot, timeoutMs });
  printJson(result);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
