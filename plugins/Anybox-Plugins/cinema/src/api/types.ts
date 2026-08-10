export type AppEnv = {
  Variables: {
    requestId: string
    runtimeMode: "anybox" | "standalone" | "test"
  }
}
