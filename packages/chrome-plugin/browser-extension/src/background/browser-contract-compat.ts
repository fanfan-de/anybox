import { BROWSER_CONTRACT_VERSION } from "@anybox/chrome-shared/browser-contract"

export function supportsBrowserCommandContractVersion(
  contractVersion: number | undefined,
) {
  return contractVersion === undefined
    || contractVersion === BROWSER_CONTRACT_VERSION
}
