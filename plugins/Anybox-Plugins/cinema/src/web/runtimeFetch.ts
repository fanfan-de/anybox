const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function cookie(name: string) {
  if (typeof document === "undefined") return undefined
  for (const item of document.cookie.split(";")) {
    const [key, ...value] = item.trim().split("=")
    if (key === name) return decodeURIComponent(value.join("="))
  }
  return undefined
}

/** Adds the double-submit token used only by the standalone loopback Runtime. */
export function cinemaRuntimeFetch(input: URL | RequestInfo, init: RequestInit = {}) {
  const requestMethod = typeof Request !== "undefined" && input instanceof Request ? input.method : "GET"
  const method = (init.method ?? requestMethod).toUpperCase()
  const headers = new Headers(init.headers)
  if (!SAFE_METHODS.has(method) && !headers.has("x-cinema-csrf")) {
    const token = cookie("cinema_csrf")
    if (token) headers.set("x-cinema-csrf", token)
  }
  return fetch(input, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers,
  })
}
