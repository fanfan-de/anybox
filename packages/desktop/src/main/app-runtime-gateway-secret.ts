import { randomBytes } from "node:crypto"

export const APP_RUNTIME_GATEWAY_SECRET_ENV = "ANYBOX_APP_GATEWAY_SECRET"

const appRuntimeGatewaySecret = randomBytes(32).toString("base64url")

export function getAppRuntimeGatewaySecret() {
  return appRuntimeGatewaySecret
}

