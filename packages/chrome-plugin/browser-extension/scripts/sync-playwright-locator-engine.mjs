import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { build, version as esbuildVersion } from "esbuild"

const PLAYWRIGHT_VERSION = "1.61.1"
const PLAYWRIGHT_TAG = `v${PLAYWRIGHT_VERSION}`
const PLAYWRIGHT_COMMIT = "39e3553a4f283a41134d75d7e404484bd9e6865a"
const INJECTED_SCRIPT_SHA256 =
  "a5eb8259c5010c66358d08ab4d3e5ad7c0134aaf7918538cbf888dff8ee10ec3"
const PLAYWRIGHT_REPOSITORY = "https://github.com/microsoft/playwright.git"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const extensionDirectory = resolve(scriptDirectory, "..")
const outputPath = join(extensionDirectory, "public", "locator-engine.js")
const metadataPath = join(
  extensionDirectory,
  "public",
  "locator-engine.metadata.json",
)
const licenseDirectory = join(extensionDirectory, "public", "licenses")
const licensePath = join(licenseDirectory, "playwright-LICENSE.txt")
const noticePath = join(licenseDirectory, "playwright-NOTICE.txt")

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`)
  }
  return resolve(value)
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim()
}

function gitBytes(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
  })
}

let checkout = argumentValue("--source")
let temporaryCheckout
if (!checkout) {
  temporaryCheckout = mkdtempSync(join(tmpdir(), "anybox-playwright-"))
  execFileSync("git", [
    "clone",
    "--depth",
    "1",
    "--branch",
    PLAYWRIGHT_TAG,
    "--filter=blob:none",
    PLAYWRIGHT_REPOSITORY,
    temporaryCheckout,
  ], { stdio: "inherit" })
  checkout = temporaryCheckout
}

try {
  const commit = git(checkout, "rev-parse", "HEAD")
  if (commit !== PLAYWRIGHT_COMMIT) {
    throw new Error(
      `Expected Playwright ${PLAYWRIGHT_TAG} at ${PLAYWRIGHT_COMMIT}, got ${commit}.`,
    )
  }
  const dirty = git(checkout, "status", "--porcelain", "--untracked-files=no")
  if (dirty) {
    throw new Error(
      "The pinned Playwright checkout has tracked modifications; use a clean checkout.",
    )
  }

  const entry = join(
    checkout,
    "packages",
    "injected",
    "src",
    "injectedScript.ts",
  )
  const entrySource = readFileSync(entry)
  const entryHash = sha256(entrySource)
  if (entryHash !== INJECTED_SCRIPT_SHA256) {
    throw new Error(
      `Pinned injectedScript.ts SHA-256 changed: expected ${INJECTED_SCRIPT_SHA256}, got ${entryHash}.`,
    )
  }

  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: ["chrome120"],
    minify: true,
    legalComments: "none",
    sourcemap: false,
    write: false,
    plugins: [{
      name: "playwright-inline-css",
      setup(context) {
        context.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.replace(/\?inline$/u, "")),
          namespace: "playwright-inline-css",
        }))
        context.onLoad(
          { filter: /.*/, namespace: "playwright-inline-css" },
          (args) => ({
            contents: readFileSync(args.path, "utf8"),
            loader: "text",
          }),
        )
      },
    }],
  })
  const bundledSource = result.outputFiles[0]?.text
  if (!bundledSource) throw new Error("esbuild did not emit an injected bundle.")

  const options = JSON.stringify({
    isUnderTest: false,
    sdkLanguage: "javascript",
    testIdAttributeName: "data-testid",
    stableRafCount: 2,
    browserName: "chromium",
    shouldPrependErrorPrefix: false,
    isUtilityWorld: true,
    customEngines: [],
  })
  const anyboxEngineWrapper = `const InjectedScript=module.exports.InjectedScript;
if(typeof InjectedScript!=="function")throw new Error("Pinned Playwright InjectedScript export is unavailable.");
const engine=new InjectedScript(globalThis,${options});
engine._engines.set("anybox-accessible-name",{queryAll(root,body){
  const matcher=JSON.parse(decodeURIComponent(String(body)));
  const matches=value=>{
    const normalized=String(value??"").replace(/\\s+/g," ").trim();
    if(matcher.type==="regex")return new RegExp(matcher.source,matcher.flags).test(normalized);
    const expected=String(matcher.value).replace(/\\s+/g," ").trim();
    return matcher.exact?normalized===expected:normalized.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
  };
  const result=[];
  const visit=current=>{
    for(const element of current.querySelectorAll("*")){
      if(matches(engine.utils.getElementAccessibleName(element,false)))result.push(element);
      if(element.shadowRoot)visit(element.shadowRoot);
    }
  };
  visit(root);
  return result;
}});
let queryCache;
const clearQueryCache=()=>{
  if(!queryCache)return;
  clearTimeout(queryCache.timer);
  queryCache.observer.disconnect();
  queryCache=undefined;
};
const observeQueryRoot=(observer,root)=>{
  observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);
  while(walker.nextNode()){
    const shadowRoot=walker.currentNode.shadowRoot;
    if(shadowRoot)observeQueryRoot(observer,shadowRoot);
  }
};
engine.querySelectorAllCached=(selector,root=document)=>{
  if(root!==document)return engine.querySelectorAll(engine.parseSelector(selector),root);
  if(queryCache?.selector===selector)return queryCache.elements;
  clearQueryCache();
  const elements=engine.querySelectorAll(engine.parseSelector(selector),root);
  const observer=new MutationObserver(clearQueryCache);
  observeQueryRoot(observer,document);
  const timer=setTimeout(clearQueryCache,50);
  queryCache={selector,elements,observer,timer};
  return elements;
};
globalThis.__anyboxPlaywrightEngine=engine;
globalThis.__anyboxPlaywrightEngineVersion=${JSON.stringify(PLAYWRIGHT_VERSION)};`
  const output = `/*! Playwright ${PLAYWRIGHT_VERSION} injected selector/actionability engine. Apache-2.0; see THIRD_PARTY_NOTICES.md. */\n(()=>{const module={exports:{}};${bundledSource}\n${anyboxEngineWrapper}})();\n`
  const outputHash = sha256(output)
  const licenseBytes = gitBytes(
    checkout,
    "show",
    `${PLAYWRIGHT_COMMIT}:LICENSE`,
  )
  const noticeBytes = gitBytes(
    checkout,
    "show",
    `${PLAYWRIGHT_COMMIT}:NOTICE`,
  )
  writeFileSync(outputPath, output)
  mkdirSync(licenseDirectory, { recursive: true })
  writeFileSync(licensePath, licenseBytes)
  writeFileSync(noticePath, noticeBytes)
  writeFileSync(metadataPath, `${JSON.stringify({
    engine: "playwright-injected-script",
    engineVersion: PLAYWRIGHT_VERSION,
    upstreamTag: PLAYWRIGHT_TAG,
    upstreamCommit: PLAYWRIGHT_COMMIT,
    upstreamEntry: "packages/injected/src/injectedScript.ts",
    upstreamEntrySha256: INJECTED_SCRIPT_SHA256,
    esbuildVersion,
    bundleSha256: outputHash,
    licenseSha256: sha256(licenseBytes),
    noticeSha256: sha256(noticeBytes),
    license: "Apache-2.0",
  }, null, 2)}\n`)

  process.stdout.write(
    `Wrote ${outputPath}, ${licensePath}, and ${noticePath}\nSHA-256 ${outputHash}\n`,
  )
} finally {
  if (temporaryCheckout) {
    rmSync(temporaryCheckout, { recursive: true, force: true })
  }
}
