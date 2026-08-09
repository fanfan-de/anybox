/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from "react"
import type { DesktopApi } from "../../shared/desktop-ipc-contract"

export {}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        allowpopups?: string
        partition?: string
        preload?: string
        src?: string
        webpreferences?: string
      }
    }
  }

  interface Window {
    desktop?: DesktopApi
  }
}
