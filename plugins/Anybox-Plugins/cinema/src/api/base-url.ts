let activeBaseURL = new URL("http://127.0.0.1:4096")

export function setServerBaseURL(input: string | URL) {
  activeBaseURL = new URL(input.toString())
}

export function getServerBaseURL() {
  return new URL(activeBaseURL.toString())
}
