import {
  BROWSER_CONTRACT_SUPPORTED_VERSIONS,
} from "@anybox/chrome-shared/browser-contract"

export function supportsBrowserCommandContractVersion(
  contractVersion: number | undefined,
) {
  return contractVersion === undefined
    || BROWSER_CONTRACT_SUPPORTED_VERSIONS.includes(
      contractVersion as (typeof BROWSER_CONTRACT_SUPPORTED_VERSIONS)[number],
    )
}
