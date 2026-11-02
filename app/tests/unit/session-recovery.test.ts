import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSessionResponse, sessionFetch, sessionRecovery } from '@/lib/auth/session-recovery'
import { requestFailureKind } from '@/components/common/request-failure'

afterEach(() => sessionRecovery.recover())

describe('expired browser identity', () => {
  it('lets an adapter distinguish proxied credentials from browser authentication', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }))
    await sessionFetch('/api/web/proxied', {}, fetcher, async () => false)
    expect(sessionRecovery.snapshot()).toBe(false)
    await sessionFetch('/api/web/proxied', {}, fetcher, async () => true)
    expect(sessionRecovery.snapshot()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('stops network requests and never retries writes after a 401', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }))
    await sessionFetch('/api/web/action', { method: 'POST' }, fetchImpl)
    expect(sessionRecovery.snapshot()).toBe(true)
    await expect(
      sessionFetch('/api/web/action', { method: 'POST' }, fetchImpl),
    ).rejects.toMatchObject({ code: 'auth_required' })
    await expect(sessionFetch('/api/web/read', {}, fetchImpl)).rejects.toMatchObject({
      code: 'auth_required',
    })
    sessionRecovery.recover()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('discards responses from before recovery, including late 401s', async () => {
    let resolve!: (response: Response) => void
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const old = sessionFetch('/api/web/read', {}, fetchImpl)
    sessionRecovery.expire()
    sessionRecovery.recover()
    resolve(new Response('{}', { status: 401 }))
    await expect(old).rejects.toMatchObject({ code: 'session_changed' })
    expect(sessionRecovery.snapshot()).toBe(false)
  })
  it('also rejects a response whose body finishes after recovery', async () => {
    const response = await sessionFetch(
      '/api/web/read',
      {},
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')),
    )
    sessionRecovery.expire()
    sessionRecovery.recover()
    expect(() => assertSessionResponse(response)).toThrow('session_changed')
  })
  it('does not mistake permissions or third-party authentication for this session', async () => {
    await sessionFetch(
      '/api/web/read',
      {},
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 403 })),
    )
    expect(sessionRecovery.snapshot()).toBe(false)
    await expect(sessionFetch('https://example.org/api/x', {})).rejects.toThrow('same-origin')
  })
  it('distinguishes authentication, authorization, missing data, contracts and servers', () => {
    expect(requestFailureKind({ status: 401 })).toBe('authentication')
    expect(requestFailureKind({ status: 403 })).toBe('forbidden')
    expect(requestFailureKind({ status: 404 })).toBe('notFound')
    expect(requestFailureKind({ code: 'contract_invalid', status: 200 })).toBe('contract')
    expect(requestFailureKind({ status: 503 })).toBe('unavailable')
  })
})
