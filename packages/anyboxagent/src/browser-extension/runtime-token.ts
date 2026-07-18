import { timingSafeEqual } from "node:crypto"

const trustedCommandToken = process.env.ANYBOX_BROWSER_TRUSTED_TOKEN?.trim() || crypto.randomUUID()
const transportToken = process.env.ANYBOX_BROWSER_TRANSPORT_TOKEN?.trim() || crypto.randomUUID()

function matchesToken(expected: string, value: string | undefined) {
  if (!value) return false
  const expectedBytes = Buffer.from(expected)
  const valueBytes = Buffer.from(value)
  return expectedBytes.length === valueBytes.length && timingSafeEqual(expectedBytes, valueBytes)
}

export function getBrowserTrustedCommandToken() {
  return trustedCommandToken
}

export function isBrowserTrustedCommandToken(value: string | undefined) {
  return matchesToken(trustedCommandToken, value)
}

export function getBrowserTransportToken() {
  return transportToken
}

export function isBrowserTransportAuthorization(value: string | undefined) {
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(value ?? "")
  return matchesToken(transportToken, match?.[1])
}
