#!/usr/bin/env node
import { execFileSync } from "node:child_process"

const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = "8081"
const DEFAULT_SCHEME = "anybox-mobile"

function readFlag(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function listBootedSimulators() {
  const output = run("xcrun", ["simctl", "list", "devices", "booted", "-j"])
  const parsed = JSON.parse(output)
  return Object.values(parsed.devices ?? {})
    .flat()
    .filter((device) => device?.udid && device?.state === "Booted" && device?.isAvailable !== false)
}

function pickSimulator(devices, requestedId) {
  if (requestedId) {
    return devices.find((device) => device.udid === requestedId) ?? { udid: requestedId, name: requestedId }
  }

  return (
    devices.find((device) => /Anybox/i.test(device.name)) ??
    devices.find((device) => /iPhone/i.test(device.name)) ??
    devices[0] ??
    null
  )
}

const host = readFlag("--host") ?? process.env.EXPO_DEV_CLIENT_HOST ?? DEFAULT_HOST
const port = readFlag("--port") ?? process.env.EXPO_DEV_CLIENT_PORT ?? DEFAULT_PORT
const scheme = readFlag("--scheme") ?? process.env.EXPO_DEV_CLIENT_SCHEME ?? DEFAULT_SCHEME
const requestedSimulator = readFlag("--simulator") ?? process.env.IOS_SIMULATOR_ID ?? process.env.SIMULATOR_UDID ?? null

const simulators = listBootedSimulators()
const simulator = pickSimulator(simulators, requestedSimulator)

if (!simulator) {
  console.error("No booted iOS simulator found. Boot a simulator, then run this command again.")
  process.exit(1)
}

const metroUrl = `http://${host}:${port}`
const devClientUrl = `${scheme}://expo-development-client/?url=${encodeURIComponent(metroUrl)}`

execFileSync("xcrun", ["simctl", "openurl", simulator.udid, devClientUrl], {
  stdio: "inherit",
})

console.log(`Opened Anybox dev client on ${simulator.name} (${simulator.udid})`)
console.log(`Metro URL: ${metroUrl}`)
