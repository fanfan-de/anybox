#!/usr/bin/env node

"use strict"

const crypto = require("node:crypto")
const net = require("node:net")
const os = require("node:os")
const readline = require("node:readline")
const tls = require("node:tls")

const CONFIG = {
  host: (process.env.SMTP_HOST || "").trim(),
  port: integerFromEnv("SMTP_PORT", 587, 1, 65535),
  security: normalizeSecurity(process.env.SMTP_SECURITY || "starttls"),
  username: (process.env.SMTP_USERNAME || "").trim(),
  password: process.env.SMTP_PASSWORD || "",
  fromEmail: (process.env.SMTP_FROM_EMAIL || "").trim(),
  fromName: (process.env.SMTP_FROM_NAME || "").trim()
}

const tools = [
  {
    name: "smtp_email_test_connection",
    title: "测试 SMTP 连接",
    description: "验证 SMTP 服务器配置和账号密码，不会发送邮件。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "smtp_email_send",
    title: "发送 SMTP 邮件",
    description: "通过配置的 SMTP 账号发送纯文本或 HTML 邮件。",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "主要收件人邮箱地址。"
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "可选的抄送邮箱地址。"
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "可选的密送邮箱地址。"
        },
        subject: {
          type: "string",
          description: "邮件主题。"
        },
        text: {
          type: "string",
          description: "纯文本邮件正文。"
        },
        html: {
          type: "string",
          description: "可选的 HTML 邮件正文。"
        },
        reply_to: {
          type: "string",
          description: "可选的 Reply-To 回复邮箱地址。"
        }
      },
      required: ["to", "subject"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    }
  }
]

function integerFromEnv(key, fallback, min, max) {
  const raw = process.env[key]
  if (raw === undefined || raw === null || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    return fallback
  }
  return value
}

function normalizeSecurity(value) {
  const normalized = String(value || "starttls").trim().toLowerCase()
  if (["starttls", "tls", "ssl", "smtps", "none", "plain"].includes(normalized)) {
    if (normalized === "ssl" || normalized === "smtps") return "tls"
    if (normalized === "plain") return "none"
    return normalized
  }
  return "starttls"
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function textResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    structuredContent: structuredContent ?? { text },
    isError: false
  }
}

function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2), value)
}

function errorResult(error) {
  const text = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: "text", text }],
    structuredContent: { error: text },
    isError: true
  }
}

function requireConfig() {
  if (!CONFIG.host) throw new Error("SMTP_HOST is not configured.")
  if (!CONFIG.username) throw new Error("SMTP_USERNAME is not configured.")
  if (!CONFIG.password) throw new Error("SMTP_PASSWORD is not configured.")
  if (!CONFIG.fromEmail) throw new Error("SMTP_FROM_EMAIL is not configured.")
  validateEmailAddress(CONFIG.fromEmail, "SMTP_FROM_EMAIL")
}

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function requireString(args, key) {
  const value = args?.[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`)
  }
  return value.trim()
}

function optionalString(args, key) {
  const value = args?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalAddressList(args, key) {
  const value = args?.[key]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${key} must be an array of email addresses.`)
  }
  return value.map((item) => validateEmailAddress(item.trim(), key))
}

function validateEmailAddress(value, label) {
  const trimmed = String(value || "").trim()
  if (!trimmed || /[\r\n<>]/.test(trimmed) || !trimmed.includes("@")) {
    throw new Error(`${label} contains an invalid email address: ${trimmed || "(empty)"}`)
  }
  return trimmed
}

function uniqueAddresses(addresses) {
  const seen = new Set()
  const result = []
  for (const address of addresses) {
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(address)
  }
  return result
}

function encodeHeader(value) {
  const text = String(value || "")
  if (/^[\t\x20-\x7e]*$/.test(text)) {
    return text.replace(/[\r\n]/g, " ")
  }
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`
}

function formatAddress(email, name) {
  const cleanEmail = validateEmailAddress(email, "email")
  if (!name) return `<${cleanEmail}>`
  return `${encodeHeader(name)} <${cleanEmail}>`
}

function formatAddressList(addresses) {
  return addresses.map((address) => `<${address}>`).join(", ")
}

function base64Body(value) {
  return Buffer.from(String(value || ""), "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .trimEnd()
}

function messageID() {
  const random = crypto.randomBytes(12).toString("hex")
  const host = CONFIG.fromEmail.split("@")[1] || CONFIG.host || os.hostname()
  return `<${Date.now()}.${random}@${host}>`
}

function buildMimeMessage({ to, cc, bcc, subject, text, html, replyTo }) {
  const visibleRecipients = [...to, ...cc]
  const headers = [
    `From: ${formatAddress(CONFIG.fromEmail, CONFIG.fromName)}`,
    `To: ${formatAddressList(to)}`,
    cc.length ? `Cc: ${formatAddressList(cc)}` : undefined,
    replyTo ? `Reply-To: <${validateEmailAddress(replyTo, "reply_to")}>` : undefined,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageID()}`,
    "MIME-Version: 1.0"
  ].filter(Boolean)

  if (visibleRecipients.length === 0 && bcc.length > 0) {
    headers.splice(1, 0, "To: undisclosed-recipients:;")
  }

  if (text && html) {
    const boundary = `anybox-${crypto.randomBytes(12).toString("hex")}`
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Body(text),
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Body(html),
      `--${boundary}--`,
      ""
    ].join("\r\n")
  }

  const body = html || text || ""
  const contentType = html ? "text/html" : "text/plain"
  return [
    ...headers,
    `Content-Type: ${contentType}; charset=utf-8`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(body),
    ""
  ].join("\r\n")
}

class SMTPClient {
  constructor(config) {
    this.config = config
    this.socket = null
    this.buffer = ""
    this.pending = []
  }

  async connect() {
    requireConfig()
    this.socket = await openSocket(this.config)
    this.attachSocket(this.socket)

    await this.expect([220], "SMTP greeting")
    let capabilities = await this.ehlo()

    if (this.config.security === "starttls") {
      if (!hasCapability(capabilities, "STARTTLS")) {
        throw new Error("SMTP server does not advertise STARTTLS.")
      }
      await this.command("STARTTLS", [220])
      this.socket.removeAllListeners("data")
      this.socket.removeAllListeners("error")
      this.socket.removeAllListeners("close")
      this.socket.removeAllListeners("timeout")
      this.socket = await upgradeToTls(this.socket, this.config.host)
      this.attachSocket(this.socket)
      this.buffer = ""
      capabilities = await this.ehlo()
    }

    await this.authenticate(capabilities)
    return capabilities
  }

  attachSocket(socket) {
    socket.setEncoding("utf8")
    socket.setTimeout(20000)
    socket.on("data", (chunk) => this.receive(chunk))
    socket.on("error", (error) => this.rejectPending(error))
    socket.on("close", () => this.rejectPending(new Error("SMTP connection closed.")))
    socket.on("timeout", () => {
      this.rejectPending(new Error("SMTP command timed out."))
      socket.destroy()
    })
  }

  async ehlo() {
    try {
      return await this.command(`EHLO ${smtpHostname()}`, [250])
    } catch {
      return this.command(`HELO ${smtpHostname()}`, [250])
    }
  }

  async authenticate(capabilities) {
    const authLine = capabilities.find((line) => /^250[ -]AUTH\b/i.test(line)) || ""
    const supportsPlain = /\bPLAIN\b/i.test(authLine)
    const supportsLogin = /\bLOGIN\b/i.test(authLine)

    if (supportsPlain || !supportsLogin) {
      try {
        const token = Buffer.from(`\0${this.config.username}\0${this.config.password}`, "utf8").toString("base64")
        await this.command(`AUTH PLAIN ${token}`, [235])
        return
      } catch (error) {
        if (!supportsLogin) throw error
      }
    }

    await this.command("AUTH LOGIN", [334])
    await this.command(Buffer.from(this.config.username, "utf8").toString("base64"), [334])
    await this.command(Buffer.from(this.config.password, "utf8").toString("base64"), [235])
  }

  async sendMail({ envelopeFrom, recipients, message }) {
    await this.command(`MAIL FROM:<${envelopeFrom}>`, [250])
    for (const recipient of recipients) {
      await this.command(`RCPT TO:<${recipient}>`, [250, 251])
    }
    await this.command("DATA", [354])
    this.write(`${dotStuff(message)}\r\n.`)
    return this.expect([250], "message accepted")
  }

  async quit() {
    if (!this.socket || this.socket.destroyed) return
    try {
      await this.command("QUIT", [221])
    } catch {
      this.socket.end()
    }
  }

  command(command, expectedCodes) {
    this.write(command)
    return this.expect(expectedCodes, command)
  }

  write(line) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("SMTP socket is not connected.")
    }
    this.socket.write(`${line}\r\n`)
  }

  expect(expectedCodes, context) {
    return new Promise((resolve, reject) => {
      this.pending.push({ expectedCodes, context, resolve, reject })
      this.flush()
    })
  }

  receive(chunk) {
    this.buffer += chunk
    this.flush()
  }

  flush() {
    if (this.pending.length === 0) return
    const parsed = parseReply(this.buffer)
    if (!parsed) return

    this.buffer = parsed.rest
    const pending = this.pending.shift()
    if (!pending.expectedCodes.includes(parsed.code)) {
      pending.reject(new Error(`${pending.context} failed: ${parsed.lines.join(" | ")}`))
      return
    }
    pending.resolve(parsed.lines)
    if (this.pending.length > 0) this.flush()
  }

  rejectPending(error) {
    while (this.pending.length > 0) {
      this.pending.shift().reject(error)
    }
  }
}

function openSocket(config) {
  return new Promise((resolve, reject) => {
    const options = {
      host: config.host,
      port: config.port,
      servername: config.host,
      timeout: 20000
    }
    const socket = config.security === "tls" ? tls.connect(options) : net.connect(options)
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onTimeout = () => {
      cleanup()
      socket.destroy()
      reject(new Error("SMTP connection timed out."))
    }
    const onConnect = () => {
      cleanup()
      resolve(socket)
    }
    const cleanup = () => {
      socket.off("error", onError)
      socket.off("timeout", onTimeout)
      socket.off(config.security === "tls" ? "secureConnect" : "connect", onConnect)
    }
    socket.once("error", onError)
    socket.once("timeout", onTimeout)
    socket.once(config.security === "tls" ? "secureConnect" : "connect", onConnect)
  })
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host }, () => {
      cleanup()
      resolve(secureSocket)
    })
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => secureSocket.off("error", onError)
    secureSocket.once("error", onError)
  })
}

function smtpHostname() {
  return os.hostname().replace(/[^\w.-]/g, "") || "localhost"
}

function hasCapability(lines, capability) {
  const pattern = new RegExp(`^250[ -]${capability}\\b`, "i")
  return lines.some((line) => pattern.test(line))
}

function parseReply(buffer) {
  const separator = buffer.indexOf("\n")
  if (separator === -1) return null

  const rawLines = buffer.split(/\r?\n/)
  const lines = []
  let consumedLength = 0
  let code = null

  for (const rawLine of rawLines) {
    const lineLength = rawLine.length + (buffer.slice(consumedLength + rawLine.length, consumedLength + rawLine.length + 2) === "\r\n" ? 2 : 1)
    if (!rawLine) {
      if (consumedLength + lineLength >= buffer.length) return null
      consumedLength += lineLength
      continue
    }

    const match = rawLine.match(/^(\d{3})([ -])(.*)$/)
    if (!match) return null
    code = Number(match[1])
    lines.push(rawLine)
    consumedLength += lineLength
    if (match[2] === " ") {
      return {
        code,
        lines,
        rest: buffer.slice(consumedLength)
      }
    }
  }

  return null
}

function dotStuff(message) {
  return String(message)
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n")
}

async function withClient(callback) {
  const client = new SMTPClient(CONFIG)
  try {
    const capabilities = await client.connect()
    return await callback(client, capabilities)
  } finally {
    await client.quit()
  }
}

async function callTool(name, rawArgs) {
  const args = asObject(rawArgs || {}, "arguments")

  if (name === "smtp_email_test_connection") {
    return withClient(async (_client, capabilities) => jsonResult({
      ok: true,
      host: CONFIG.host,
      port: CONFIG.port,
      security: CONFIG.security,
      username: CONFIG.username,
      from_email: CONFIG.fromEmail,
      tls_active: CONFIG.security === "tls" || CONFIG.security === "starttls",
      capabilities: capabilities.map((line) => line.replace(/^250[ -]/, ""))
    }))
  }

  if (name === "smtp_email_send") {
    const to = optionalAddressList(args, "to")
    const cc = optionalAddressList(args, "cc")
    const bcc = optionalAddressList(args, "bcc")
    const recipients = uniqueAddresses([...to, ...cc, ...bcc])
    if (to.length === 0) throw new Error("to must include at least one recipient.")
    if (recipients.length === 0) throw new Error("At least one recipient is required.")

    const subject = requireString(args, "subject")
    const text = optionalString(args, "text")
    const html = optionalString(args, "html")
    if (!text && !html) throw new Error("Provide text or html body content.")

    const replyTo = optionalString(args, "reply_to")
    if (replyTo) validateEmailAddress(replyTo, "reply_to")

    const message = buildMimeMessage({
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      replyTo
    })

    return withClient(async (client) => {
      const acceptedLines = await client.sendMail({
        envelopeFrom: CONFIG.fromEmail,
        recipients,
        message
      })
      return jsonResult({
        ok: true,
        from: CONFIG.fromEmail,
        to,
        cc,
        bcc_count: bcc.length,
        subject,
        smtp_response: acceptedLines.join(" | ")
      })
    })
  }

  throw new Error(`Unknown tool: ${name}`)
}

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  void (async () => {
    const normalizedLine = line.replace(/^\uFEFF/, "")
    if (!normalizedLine.trim()) return
    const message = JSON.parse(normalizedLine)

    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "smtp-email", version: "0.1.0" }
        }
      })
      return
    }

    if (String(message.method || "").startsWith("notifications/")) return

    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } })
      return
    }

    if (message.method === "tools/call") {
      try {
        const result = await callTool(message.params?.name, message.params?.arguments)
        send({ jsonrpc: "2.0", id: message.id, result })
      } catch (error) {
        send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
      }
      return
    }

    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unknown method: ${message.method}` }
    })
  })().catch((error) => {
    send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    })
  })
})
