import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationEventsProvider } from '@/lib/workbench/conversation-events'
import { sessionRecovery } from '@/lib/auth/session-recovery'

const streams: FakeSource[] = []
class FakeSource {
  onopen = null
  onmessage = null
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
