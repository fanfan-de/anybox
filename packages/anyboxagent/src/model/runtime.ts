import * as Provider from "#provider/provider.ts"
import type { Model } from "#model/types.ts"

export async function getLanguage(model: Model, configID?: string) {
  return Provider.getLanguage(model, configID)
}

export async function getImage(model: Model, configID?: string) {
  return Provider.getImage(model, configID)
}

export async function getSDKProvider(model: Model, configID?: string) {
  return Provider.getSDKProvider(model, configID)
}

