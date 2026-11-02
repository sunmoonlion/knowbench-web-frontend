// Tab-local state only. Never store identity, cookies, tokens or unfinished actions.
export class SessionRecoveryGate {
  private expired = false
  private generation = 0
  private listeners = new Set<() => void>()
  snapshot = () => this.expired
  version = () => this.generation
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  expire(version = this.generation) {
    if (version !== this.generation || this.expired) return
    this.expired = true
    this.generation += 1
    this.listeners.forEach((listener) => listener())
  }
  recover() {
    this.expired = false
    this.generation += 1
    this.listeners.forEach((listener) => listener())
  }
}

export class SessionRequestError extends Error {
  constructor(public readonly code: 'auth_required' | 'session_changed') {
    super(code)
    this.name = 'SessionRequestError'
  }
}

export const sessionRecovery = new SessionRecoveryGate()
const responses = new WeakMap<Response, number>()

export function assertSessionResponse(response: Response) {
  const version = responses.get(response)
  if (version !== undefined && version !== sessionRecovery.version()) {
    throw new SessionRequestError('session_changed')
  }
}

// Only same-origin application APIs participate; third-party/local-agent 401s
// must not expire the application's browser session. No retry or queued action.
export async function sessionFetch(
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
  isSessionUnauthorized: () => Promise<boolean> = async () => true,
) {
  if (!path.startsWith('/api/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('sessionFetch requires a same-origin API path')
  }
  if (typeof window === 'undefined') return fetchImpl(path, init)
  if (sessionRecovery.snapshot()) throw new SessionRequestError('auth_required')
  const version = sessionRecovery.version()
  const response = await fetchImpl(path, init)
  if (version !== sessionRecovery.version()) throw new SessionRequestError('session_changed')
  responses.set(response, version)
  // Proxied resource authentication may share HTTP 401 with browser login.
  // The adapter can check the authoritative session without replaying the request.
  if (response.status === 401 && (await isSessionUnauthorized())) sessionRecovery.expire(version)
  return response
}
