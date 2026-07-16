import type {
  RegistryDownloadDescriptor,
  RegistryCapabilities,
  RegistryFile,
  RegistryFileContent,
  RegistryProviderDescriptor,
  RegistryProviderError,
  RegistrySearchInput,
  RegistrySecuritySnapshot,
  RegistrySkillDetail,
  RegistrySkillRef,
  RegistrySkillSummary,
  RegistryVersion,
  RegistryVersionRef,
  RegistryFileRef,
} from "@anybox/shared/skill-registry"

export * from "@anybox/shared/skill-registry"

export type RegistryProviderSearchInput = Omit<RegistrySearchInput, "providers" | "cursor"> & {
  cursor?: string
}

export interface RegistryProviderSearchPage {
  items: RegistrySkillSummary[]
  nextCursor?: string
  errors?: RegistryProviderError[]
}

export interface SkillRegistryProvider {
  readonly id: string
  readonly capabilities: RegistryCapabilities
  getDescriptor(): Promise<RegistryProviderDescriptor>
  search(input: RegistryProviderSearchInput, signal?: AbortSignal): Promise<RegistryProviderSearchPage>
  getDetail(input: RegistrySkillRef, signal?: AbortSignal): Promise<RegistrySkillDetail>
  listVersions(input: RegistrySkillRef, signal?: AbortSignal): Promise<RegistryVersion[]>
  listFiles(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistryFile[]>
  readFile(input: RegistryFileRef, signal?: AbortSignal): Promise<RegistryFileContent>
  resolveDownload(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistryDownloadDescriptor>
  getSecurity(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistrySecuritySnapshot>
  invalidateCache?(): void | Promise<void>
}

export type RegistryFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>
