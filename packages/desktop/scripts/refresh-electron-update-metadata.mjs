import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

const [metadataArgument, payloadArgument] = process.argv.slice(2)
if (!metadataArgument || !payloadArgument) {
  throw new Error("Usage: refresh-electron-update-metadata <latest.yml> <payload>")
}
const metadataPath = path.resolve(metadataArgument)
const payloadPath = path.resolve(payloadArgument)
const payloadName = path.basename(payloadPath)
const stat = await fsp.stat(payloadPath)
const hash = createHash("sha512")
for await (const chunk of fs.createReadStream(payloadPath)) hash.update(chunk)
const sha512 = hash.digest("base64")
const lines = (await fsp.readFile(metadataPath, "utf8")).split(/\r?\n/)
const urlIndex = lines.findIndex((line) => {
  const match = line.match(/^\s*-\s+url:\s*['"]?(.+?)['"]?\s*$/)
  return match && path.basename(match[1]) === payloadName
})
if (urlIndex < 0) throw new Error(`${path.basename(metadataPath)} does not list ${payloadName}`)
const urlIndent = lines[urlIndex].match(/^\s*/)[0].length
let shaUpdated = false
let sizeUpdated = false
for (let index = urlIndex + 1; index < lines.length; index += 1) {
  const line = lines[index]
  const indent = line.match(/^\s*/)[0].length
  if (line.trim() && indent <= urlIndent) break
  if (/^\s*sha512:/.test(line)) {
    lines[index] = `${line.match(/^\s*/)[0]}sha512: ${sha512}`
    shaUpdated = true
  } else if (/^\s*size:/.test(line)) {
    lines[index] = `${line.match(/^\s*/)[0]}size: ${stat.size}`
    sizeUpdated = true
  }
}
if (!shaUpdated || !sizeUpdated) throw new Error(`${path.basename(metadataPath)} has no complete ${payloadName} hash/size entry`)
await fsp.writeFile(metadataPath, `${lines.join("\n").replace(/\n+$/, "")}\n`)
console.log(`[desktop][release] refreshed ${payloadName} updater metadata after notarization stapling`)
