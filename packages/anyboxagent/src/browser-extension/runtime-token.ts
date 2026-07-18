const token = process.env.ANYBOX_BROWSER_TRUSTED_TOKEN?.trim() || crypto.randomUUID()
process.env.ANYBOX_BROWSER_TRUSTED_TOKEN = token

export function getBrowserTrustedCommandToken() {
  return token
}

export function isBrowserTrustedCommandToken(value: string | undefined) {
  return Boolean(value && value === token)
}
