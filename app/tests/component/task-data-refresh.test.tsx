import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { useTaskData } from '@/lib/workbench/task-data'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('没有对话事件也刷新采集快照，失败转待处理后停止轮询', async () => {
  vi.useFakeTimers()
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ listed: true, status: 'waiting' }))
    .mockResolvedValue(
      Response.json({
        listed: true,
        status: 'ready',
        demand_status: 'failed',
        requests: [{ id: 'r1', labels: ['年报'], status: 'missing', missing: ['年报'] }],
      }),
    )
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { result, unmount } = renderHook(() => useTaskData('task-a', 0), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(result.current.data?.status).toBe('waiting')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_001)
  })
  expect(result.current.data?.requests[0].status).toBe('missing')
  expect(fetcher).toHaveBeenCalledTimes(2)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000)
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
  unmount()
  client.clear()
})
