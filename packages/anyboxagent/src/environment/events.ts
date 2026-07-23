import type {
  EnvironmentCandidate,
  EnvironmentRunRecord,
} from "#environment/types.ts"

export type EnvironmentEventName =
  | "environment.run.created"
  | "environment.run.updated"
  | "environment.run.output"
  | "environment.run.completed"
  | "environment.definition.changed"

export type EnvironmentEventDataByName = {
  "environment.run.created": { run: EnvironmentRunRecord }
  "environment.run.updated": { run: EnvironmentRunRecord }
  "environment.run.output": { runID: string; chunk: string }
  "environment.run.completed": { run: EnvironmentRunRecord }
  "environment.definition.changed": {
    projectID: string
    directory: string
    environment?: EnvironmentCandidate
  }
}

export type EnvironmentEventRecord<TName extends EnvironmentEventName = EnvironmentEventName> = {
  id: string
  event: TName
  data: EnvironmentEventDataByName[TName]
  timestamp: number
}

const MAX_REPLAY_EVENTS = 1_000
const subscribers = new Set<(event: EnvironmentEventRecord) => void>()
const replayBuffer: EnvironmentEventRecord[] = []
let sequence = 0

export function publish<TName extends EnvironmentEventName>(
  event: TName,
  data: EnvironmentEventDataByName[TName],
) {
  const timestamp = Date.now()
  const record = {
    id: `${timestamp}:${++sequence}`,
    event,
    data,
    timestamp,
  } satisfies EnvironmentEventRecord<TName>

  replayBuffer.push(record as EnvironmentEventRecord)
  if (replayBuffer.length > MAX_REPLAY_EVENTS) {
    replayBuffer.splice(0, replayBuffer.length - MAX_REPLAY_EVENTS)
  }

  for (const subscriber of [...subscribers]) {
    try {
      subscriber(record as EnvironmentEventRecord)
    } catch {
      subscribers.delete(subscriber)
    }
  }

  return record
}

export function subscribe(subscriber: (event: EnvironmentEventRecord) => void) {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

export function listEventsAfter(lastEventID?: string) {
  if (!lastEventID) return []
  const index = replayBuffer.findIndex((event) => event.id === lastEventID)
  if (index === -1) return [...replayBuffer]
  return replayBuffer.slice(index + 1)
}

export function toSSE(record: EnvironmentEventRecord) {
  return [
    `id: ${record.id}`,
    `event: ${record.event}`,
    `data: ${JSON.stringify(record.data)}`,
    "",
    "",
  ].join("\n")
}

export const internal = {
  replayBuffer,
  subscribers,
}
