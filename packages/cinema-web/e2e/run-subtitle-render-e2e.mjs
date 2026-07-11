import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const FONT_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf"
const FONT_SHA256 = "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b"
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const fontDirectory = path.resolve(moduleDirectory, "../../desktop/build/subtitle-e2e-runtime/fonts")
const fontPath = path.join(fontDirectory, "NotoSansCJKsc-Regular.otf")

function digest(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function ensureReviewedFont() {
  await mkdir(fontDirectory, { recursive: true })
  let font
  try {
    font = await readFile(fontPath)
  } catch {
    const response = await fetch(FONT_URL)
    if (!response.ok) throw new Error(`Could not download the reviewed subtitle font: HTTP ${response.status}`)
    font = Buffer.from(await response.arrayBuffer())
    await writeFile(fontPath, font)
  }
  const actual = digest(font)
  if (actual !== FONT_SHA256) {
    throw new Error(`Reviewed subtitle font digest mismatch: expected ${FONT_SHA256}, received ${actual}`)
  }
  return fontPath
}

const reviewedFont = await ensureReviewedFont()
const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack"
const child = spawn(
  corepack,
  ["pnpm@10.28.0", "exec", "playwright", "test", "e2e/deliver-subtitles.pw.ts", "--workers=1"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ANYBOX_SUBTITLE_FONT: reviewedFont,
      VITE_CINEMA_DELIVER_DEV: "1",
      CINEMA_E2E_AGENT_PORT: process.env.CINEMA_E2E_AGENT_PORT || "4298",
    },
  },
)

child.on("error", (error) => {
  console.error(`[cinema-subtitle-render-e2e] ${error.message}`)
  process.exitCode = 1
})

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[cinema-subtitle-render-e2e] Playwright stopped by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
