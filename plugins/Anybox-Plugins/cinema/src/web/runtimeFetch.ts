const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function cookie(name: string) {
  if (typeof document === "undefined") return undefined
  for (const item of document.cookie.split(";")) {
    const [key, ...value] = item.trim().split("=")
    if (key === name) return decodeURIComponent(value.join("="))
  }
  return undefined
}

function csrfToken(method: string) {
  return SAFE_METHODS.has(method.toUpperCase()) ? undefined : cookie("cinema_csrf")
}

export function applyCinemaRuntimeXHRHeaders(
  xhr: Pick<XMLHttpRequest, "setRequestHeader">,
  method: string,
) {
  const token = csrfToken(method)
  if (token) xhr.setRequestHeader("x-cinema-csrf", token)
}

/** Adds the double-submit token used only by the standalone loopback Runtime. */
export function cinemaRuntimeFetch(input: URL | RequestInfo, init: RequestInit = {}) {
  const requestMethod = typeof Request !== "undefined" && input instanceof Request ? input.method : "GET"
  const method = (init.method ?? requestMethod).toUpperCase()
  const headers = new Headers(init.headers)
  if (!SAFE_METHODS.has(method) && !headers.has("x-cinema-csrf")) {
    const token = csrfToken(method)
    if (token) headers.set("x-cinema-csrf", token)
  }
  return fetch(input, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers,
  })
}
