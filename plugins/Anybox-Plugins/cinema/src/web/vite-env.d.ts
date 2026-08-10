/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CINEMA_EDIT_DEV?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
