export function isSshWorkspaceUri(value: string) {
  return /^ssh:\/\//i.test(value.trim())
}
