import { expect, test } from "bun:test"
import { Instance } from "#project/instance.ts"
import * as Provider from "#provider/provider.ts"

test("provider accepts SDK packages declared by models.dev using a single create factory", async () => {
  const languageModel = {
    provider: "trusted",
    doGenerate() {},
    doStream() {},
  }
  const capturedImports: Array<{ pkg: string; version?: string; importSpecifier?: string }> = []

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () =>
      ({
        trusted: {
          id: "trusted",
          name: "Trusted",
          env: ["TRUSTED_API_KEY"],
          npm: "trusted-ai-sdk-provider",
          models: {
            "trusted-model": {
              id: "trusted-model",
              name: "Trusted Model",
              release_date: "2026-01-01",
              attachment: false,
              reasoning: false,
              temperature: true,
              tool_call: true,
              limit: {
                context: 8_192,
                output: 4_096,
              },
              modalities: {
                input: ["text"],
                output: ["text"],
              },
              options: {},
            },
          },
        },
      }) as never,
    getConfig: async () => ({}) as never,
    getEnvAll: () => ({
      TRUSTED_API_KEY: "test-trusted-key",
    }),
    importPackage: async (pkg: string, version?: string, importSpecifier?: string) => {
      capturedImports.push({ pkg, version, importSpecifier })
      return {
        name: pkg,
        version: version ?? "test-version",
        entry: `${pkg}/index.js`,
        root: pkg,
        module: {
          createTrustedProvider() {
            return {
              languageModel() {
                return languageModel
              },
            }
          },
        },
      }
    },
  })

  try {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const model = await Provider.getModel("trusted", "trusted-model")
        const language = await Provider.getLanguage(model)

        expect(model.api.npm).toBe("trusted-ai-sdk-provider")
        expect(language).toMatchObject(languageModel)
        expect(capturedImports).toEqual([
          {
            pkg: "trusted-ai-sdk-provider",
            version: undefined,
            importSpecifier: "trusted-ai-sdk-provider",
          },
        ])
      },
    })
  } finally {
    restoreProvider()
  }
})

test("provider rejects custom SDK packages that are not declared by models.dev", async () => {
  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () =>
      ({
        provider: {
          custom: {
            name: "Custom",
            env: ["CUSTOM_API_KEY"],
            npm: "custom-ai-sdk-provider",
            models: {
              "custom-model": {
                id: "custom-model",
                name: "Custom Model",
              },
            },
          },
        },
      }) as never,
    getEnvAll: () => ({
      CUSTOM_API_KEY: "test-custom-key",
    }),
    importPackage: async () => {
      throw new Error("untrusted package should not be imported")
    },
  })

  try {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const model = await Provider.getModel("custom", "custom-model")
        await expect(Provider.getLanguage(model)).rejects.toThrow(
          "Unsupported SDK package 'custom-ai-sdk-provider'",
        )
      },
    })
  } finally {
    restoreProvider()
  }
})

test("provider imports SDK subpath packages through their install package", async () => {
  const languageModel = {
    provider: "vertex-anthropic",
    doGenerate() {},
    doStream() {},
  }
  const capturedImports: Array<{ pkg: string; version?: string; importSpecifier?: string }> = []

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () =>
      ({
        provider: {
          "vertex-anthropic": {
            name: "Vertex Anthropic",
            env: ["GOOGLE_APPLICATION_CREDENTIALS"],
            npm: "@ai-sdk/google-vertex/anthropic",
            models: {
              "claude-sonnet-4-6@default": {
                id: "claude-sonnet-4-6@default",
                name: "Claude Sonnet",
              },
            },
          },
        },
      }) as never,
    getEnvAll: () => ({
      GOOGLE_APPLICATION_CREDENTIALS: "test-credentials.json",
    }),
    importPackage: async (pkg: string, version?: string, importSpecifier?: string) => {
      capturedImports.push({ pkg, version, importSpecifier })
      return {
        name: pkg,
        version: version ?? "test-version",
        entry: `${pkg}/index.js`,
        root: pkg,
        module: {
          createVertexAnthropic() {
            return {
              languageModel() {
                return languageModel
              },
            }
          },
        },
      }
    },
  })

  try {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const model = await Provider.getModel("vertex-anthropic", "claude-sonnet-4-6@default")
        const language = await Provider.getLanguage(model)

        expect(language).toMatchObject(languageModel)
        expect(capturedImports).toEqual([
          {
            pkg: "@ai-sdk/google-vertex",
            version: "5.0.36",
            importSpecifier: "@ai-sdk/google-vertex/anthropic",
          },
        ])
      },
    })
  } finally {
    restoreProvider()
  }
})
