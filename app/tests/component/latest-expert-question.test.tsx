import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useSaid } from '@/features/expert/api/desk'

it('长会话请专家，核对草稿使用的最后一句', async () => {
  const sid = '11111111-1111-4111-8111-111111111111'
  const events = Array.from({ length: 1001 }, (_, i) => ({
    id: sid,
    session_id: sid,
    task_id: null,
    attempt_id: null,
    cursor: i + 1,
    kind: 'turn',
    type: i === 0 || i === 1000 ? 'turn/requested' : 'turn/completed',
    created_at: '2026-11-26T00:00:00Z',
    payload: { text: i === 1000 ? '核对现金流' : '核对资产' },
  }))
  const fetchPage = vi.fn(async (path: string) => {
    const params = new URL(path, 'http://localhost').searchParams
    const page =
      params.get('latest_user_prompt') === 'true'
        ? events.filter((e) => e.type === 'turn/requested').slice(-1)
        : events.slice(0, 1000)
    return Response.json({ events: page, next_cursor: page.at(-1)?.cursor ?? 0 })
  })
  vi.stubGlobal('fetch', fetchPage)
  const client = new QueryClient()
  try {
    const hook = renderHook(() => useSaid(sid), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))
    expect(hook.result.current.data).toEqual({ eventId: sid, last: '核对现金流' })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  } finally {
    client.clear()
    vi.unstubAllGlobals()
  }
})
