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
  const timeoutMs = asNumber(args.timeoutMs, 30000);
  const result = await runWorker("build-deck", {
    pluginRoot,
    workspacesRoot: projectWorkspacesRoot(projectRoot),
    workspaceDir: workspace,
  }, { pluginRoot, timeoutMs });
  printJson(result);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
