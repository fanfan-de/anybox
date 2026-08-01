import z from "zod"
import { randomBytes } from "crypto"


const prefixes = {
  project: "prj",
  session: "ses",
  turn: "trn",
  event: "evt",
  message: "msg",
  permission: "per",
  question: "que",
  compaction: "cmp",
  automation: "aut",
  automationRun: "arn",
  environmentBinding: "envb",
  environmentRun: "envr",
  user: "usr",
  worktree: "wtr",
  part: "prt",
  pty: "pty",
  task: "tsk",
  plannerProposal: "plp",
  plannerRun: "plr",
  plannerAudit: "pla",
  tool: "tool",
} as const

export function schema(prefix: keyof typeof prefixes) {
  return z.string().startsWith(prefixes[prefix])
}

const LENGTH = 26

// State for monotonic ID generation
let lastTimestamp = 0
let counter = 0
/**
 * 升序 全局ID编码 生成
 * @param prefix ID固定前缀
 * @param given 
 * @returns 
 */
export function ascending(prefix: keyof typeof prefixes, given?: string) {
  return generateID(prefix, false, given)
}
/**
 * 用于生成一&#x4E2A;__&#x5355;调递减的唯一标识符__。
 * 它接收一个前缀（如 "session"、"message" 等）和一个可选的给定字符串，
 * 返回一个以该前缀开头、后面跟着时间戳（取反）和随机字符的 ID。
 * 这种递减设计使得按字符串排序时，较新的 ID 会排在前面，适用于需要按时间倒序排列的场景（例如日志、消息记录）。
 * @param prefix 
 * @param descending 
 * @param given 
 * @returns 
 */
export function descending(prefix: keyof typeof prefixes, given?: string) {
  return generateID(prefix, true, given)
}

function generateID(prefix: keyof typeof prefixes, descending: boolean, given?: string): string {
  if (!given) {
    return create(prefix, descending)
  }

  if (!given.startsWith(prefixes[prefix])) {
    throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
  }
  return given
}

function randomBase62(length: number): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  let result = ""
  const bytes = randomBytes(length)
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i]! % 62]
  }
  return result
}

export function create(prefix: keyof typeof prefixes, descending: boolean, timestamp?: number): string {
  const currentTimestamp = timestamp ?? Date.now()

  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp
    counter = 0
  }
  counter++

  let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

  now = descending ? ~now : now

  const timeBytes = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }

  return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - 12)
}

/** Extract timestamp from an ascending ID. Does not work with descending IDs. */
export function timestamp(id: string): number {
  const prefix = id.split("_")[0]
  const hex = id.slice(prefix!.length + 1, prefix!.length + 13)
  const encoded = BigInt("0x" + hex)
  return Number(encoded / BigInt(0x1000))
}

