import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inflateSync } from "node:zlib"

const require = createRequire(import.meta.url)
const { HelperClient } = require("./lib/helper-client")

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(scriptDirectory, "..")
const helperPath = path.join(pluginRoot, "helper", "win32-x64", "computer-use-helper.exe")
const testAppPath = path.join(
  pluginRoot,
  ".cache",
  "test-app-build",
  "bin",
  "ComputerUse.TestApp",
  "release",
  "computer-use-test-app.exe",
)
const artifactDirectory = path.join(pluginRoot, ".cache", "wgc-smoke")
const targetTitle = "Anybox Computer Use Test Fixture"
const occluderTitle = "Anybox Computer Use Test Occluder"

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function waitForReady(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = ""
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for the controlled test window."))
    }, timeoutMs)
    const onData = (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      try {
        const message = JSON.parse(buffer.slice(0, newline))
        cleanup()
        resolve(message)
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`Controlled test window exited before it was ready (${code}).`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout.off("data", onData)
      child.off("exit", onExit)
    }
    child.stdout.on("data", onData)
    child.once("exit", onExit)
  })
}

async function startFixture(args = []) {
  const child = spawn(testAppPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8")
  })
  try {
    const ready = await waitForReady(child)
    return { child, ready, stderr: () => stderr }
  } catch (error) {
    child.kill()
    throw error
  }
}

async function stopFixture(fixture) {
  if (!fixture?.child || fixture.child.exitCode !== null) return
  const exited = new Promise((resolve) => fixture.child.once("exit", resolve))
  fixture.child.kill()
  await Promise.race([exited, delay(2000)])
}

async function waitForWindow(helper, title, predicate = () => true, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await helper.call("list_windows")
    const match = result.windows?.find((window) => window.title === title && predicate(window))
    if (match) return match
    await delay(75)
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for helper window: ${title}`)
}

async function capture(helper, window) {
  return helper.call("get_window_state", {
    expectedIdentity: window.identity,
    includeScreenshot: true,
    includeAccessibility: false,
  }, { timeoutMs: 20_000 })
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const upDistance = Math.abs(prediction - up)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  if (upDistance <= upperLeftDistance) return up
  return upperLeft
}

function decodePng(buffer) {
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "capture must be a PNG",
  )
  let offset = 8
  let width
  let height
  let bitDepth
  let colorType
  let interlace
  const compressed = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === "IDAT") {
      compressed.push(data)
    } else if (type === "IEND") {
      break
    }
    offset += 12 + length
  }
  assert.equal(bitDepth, 8, "smoke decoder supports 8-bit WGC PNG output")
  assert.ok(colorType === 2 || colorType === 6, `unexpected PNG color type: ${colorType}`)
  assert.equal(interlace, 0, "smoke decoder supports non-interlaced WGC PNG output")
  const bytesPerPixel = colorType === 6 ? 4 : 3
  const rowBytes = width * bytesPerPixel
  const raw = inflateSync(Buffer.concat(compressed))
  assert.equal(raw.length, height * (rowBytes + 1))
  const pixels = Buffer.allocUnsafe(height * rowBytes)
  let rawOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset]
    rawOffset += 1
    const rowOffset = y * rowBytes
    const previousOffset = rowOffset - rowBytes
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = raw[rawOffset + x]
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0
      const up = y > 0 ? pixels[previousOffset + x] : 0
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[previousOffset + x - bytesPerPixel]
        : 0
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : filter === 4
                ? paeth(left, up, upperLeft)
                : assert.fail(`unexpected PNG row filter: ${filter}`)
      pixels[rowOffset + x] = (encoded + predictor) & 0xff
    }
    rawOffset += rowBytes
  }
  return { width, height, colorType, bytesPerPixel, pixels }
}

function countColor(image, expected) {
  let count = 0
  for (let offset = 0; offset < image.pixels.length; offset += image.bytesPerPixel) {
    if (
      image.pixels[offset] === expected[0]
      && image.pixels[offset + 1] === expected[1]
      && image.pixels[offset + 2] === expected[2]
    ) {
      count += 1
    }
  }
  return count
}

async function saveAndInspect(name, result) {
  const png = Buffer.from(result.screenshot.imageBase64, "base64")
  const image = decodePng(png)
  assert.equal(image.width, result.screenshot.width)
  assert.equal(image.height, result.screenshot.height)
  const file = path.join(artifactDirectory, `${name}.png`)
  await fs.writeFile(file, png)
  return {
    file,
    width: image.width,
    height: image.height,
    bluePixels: countColor(image, [36, 99, 235]),
    tealPixels: countColor(image, [0, 174, 156]),
    occluderPixels: countColor(image, [255, 0, 170]),
  }
}

async function main() {
  await fs.mkdir(artifactDirectory, { recursive: true })
  const helper = new HelperClient({
    helperPath,
    cwd: pluginRoot,
    defaultTimeoutMs: 10_000,
  })
  let target
  let occluder
  let minimized
  let negative
  try {
    target = await startFixture()
    const targetWindow = await waitForWindow(helper, targetTitle)
    const unobscured = await saveAndInspect("target-unobscured", await capture(helper, targetWindow))
    assert.ok(unobscured.bluePixels > 20_000, "target capture must contain its blue marker panel")
    assert.ok(unobscured.tealPixels > 20_000, "target capture must contain its teal header")
    assert.equal(unobscured.occluderPixels, 0)

    occluder = await startFixture(["--occluder"])
    await waitForWindow(helper, occluderTitle)
    await delay(250)
    const obscured = await saveAndInspect("target-while-occluded", await capture(helper, targetWindow))
    assert.equal(obscured.bluePixels, unobscured.bluePixels)
    assert.equal(obscured.tealPixels, unobscured.tealPixels)
    assert.equal(
      obscured.occluderPixels,
      0,
      "the covering window must not leak into the target WGC frame",
    )

    await stopFixture(occluder)
    occluder = undefined
    await stopFixture(target)
    target = undefined

    minimized = await startFixture(["--minimized", "--left", "180", "--top", "180"])
    const minimizedWindow = await waitForWindow(
      helper,
      targetTitle,
      (window) => window.minimized === true,
    )
    await assert.rejects(
      capture(helper, minimizedWindow),
      (error) => error?.code === "CU_WINDOW_CHANGED" && error?.requiresFreshState === true,
    )
    await stopFixture(minimized)
    minimized = undefined

    negative = await startFixture(["--left", "-2300", "--top", "160"])
    const negativeWindow = await waitForWindow(
      helper,
      targetTitle,
      (window) => window.bounds?.x < 0,
    )
    assert.ok(negativeWindow.dpiScale > 0)
    const negativeCapture = await saveAndInspect(
      "target-negative-monitor",
      await capture(helper, negativeWindow),
    )
    assert.ok(negativeCapture.bluePixels > 20_000)
    assert.ok(negativeCapture.tealPixels > 20_000)

    process.stdout.write(`${JSON.stringify({
      ok: true,
      captureBackend: "windows-graphics-capture",
      unobscured,
      obscured,
      minimizedError: "CU_WINDOW_CHANGED",
      negativeCoordinates: {
        windowX: negativeWindow.bounds.x,
        windowY: negativeWindow.bounds.y,
        dpiScale: negativeWindow.dpiScale,
        capture: negativeCapture,
      },
    }, null, 2)}\n`)
  } finally {
    helper.stop()
    await stopFixture(occluder)
    await stopFixture(target)
    await stopFixture(minimized)
    await stopFixture(negative)
  }
}

await main()
