import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationEventsProvider } from '@/lib/workbench/conversation-events'
import { sessionRecovery } from '@/lib/auth/session-recovery'

const streams: FakeSource[] = []
class FakeSource {
  onopen = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror = null
  close = vi.fn()
  constructor() {
    streams.push(this)
  }
}
afterEach(() => {
  cleanup()
  sessionRecovery.recover()
  vi.unstubAllGlobals()
  streams.length = 0
})
it('closes the conversation stream on expired identity and resumes with read-only catch-up', async () => {
  const fetcher = vi.fn(async () => Response.json({ events: [], next_cursor: null }))
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('EventSource', FakeSource)
  render(
    <ConversationEventsProvider conversation="test">
      <span>content</span>
    </ConversationEventsProvider>,
  )
  await waitFor(() => expect(streams).toHaveLength(1))
  act(() => sessionRecovery.expire())
  await waitFor(() => expect(streams[0].close).toHaveBeenCalledTimes(1))
  expect(fetcher).toHaveBeenCalledTimes(1)
  act(() => sessionRecovery.recover())
  await waitFor(() => expect(streams).toHaveLength(2))
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(
    fetcher.mock.calls.every(
      (call) => (call as unknown as [string, RequestInit])[1].method === 'GET',
    ),
  ).toBe(true)
})

it('replays a malformed frame before accepting later frames', async () => {
  const fetcher = vi.fn(async (_url: string) => Response.json({ events: [], next_cursor: null }))
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('EventSource', FakeSource)
  render(
    <ConversationEventsProvider conversation="test">
      <span>test</span>
    </ConversationEventsProvider>,
  )
  await waitFor(() => expect(streams).toHaveLength(1))
  const deliver = (cursor: number) =>
    JSON.stringify({
      id: '00000000-0000-4000-8000-000000000001',
      session_id: '00000000-0000-4000-8000-000000000002',
      kind: 'x',
      task_id: null,
      attempt_id: null,
      type: 'turn/requested',
      cursor,
      payload: {},
      created_at: '2026-11-28T00:00:00Z',
    })
  act(() => {
    streams[0].onmessage?.({ data: deliver(1) })
    streams[0].onmessage?.({ data: 'incomplete' })
    streams[0].onmessage?.({ data: deliver(3) })
  })
  expect(streams[0].close).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(streams).toHaveLength(2), { timeout: 3500 })
  expect(String(fetcher.mock.calls[1][0])).toContain('after=1')
})
