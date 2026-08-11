export function createNonOverlappingPoll(run: () => Promise<void>) {
  let inFlight = false
  return async () => {
    if (inFlight) return false
    inFlight = true
    try {
      await run()
      return true
    } finally {
      inFlight = false
    }
  }
}

export async function refreshGenerationTasksIndependently(
  taskIDs: readonly string[],
  refreshTask: (taskID: string) => Promise<unknown>,
) {
  return await Promise.allSettled(taskIDs.map((taskID) => refreshTask(taskID)))
}
