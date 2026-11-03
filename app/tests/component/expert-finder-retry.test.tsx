import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { WorkbenchProvider } from '@/lib/workbench/context'
import { useExpertFinder } from '@/lib/workbench/expert-finder'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
afterEach(() => vi.unstubAllGlobals())

it('lost response and active round reuse the key; an explicit retry after completion gets a new round', async () => {
  window.sessionStorage.clear()
  const task = '11111111-1111-4111-8111-111111111111'
  const project = '22222222-2222-4222-8222-222222222222'
  const keys: string[] = []
  let lost = true
  let state = 'RUNNING'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        keys.push(JSON.parse(String(init.body)).idempotency_key)
        if (lost) {
          lost = false
          throw new Error('response lost')
        }
        return Response.json({ task_id: task, session_id: task }, { status: 201 })
      }
      return Response.json({
        task_id: task,
        project_id: project,
        question: '分析营收',
        state,
      })
    }),
  )
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const { result } = renderHook(() => useExpertFinder(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf" locale="zh-CN">
          {children}
        </WorkbenchProvider>
      </QueryClientProvider>
    ),
  })
  const input = { project, question: '分析营收', from: null }
  await act(async () => {
    await expect(result.current.find(input)).rejects.toBeDefined()
  })
  await act(async () => {
    await result.current.find(input)
  })
  await act(async () => {
    await result.current.find(input)
  })
  expect(new Set(keys).size).toBe(1)
  expect(push).toHaveBeenLastCalledWith(expect.stringContaining(`match=${task}`))
  state = 'FAILED'
  await act(async () => {
    await result.current.find(input)
  })
  expect(keys[3]).not.toBe(keys[2])
})

it('a specified expert and source conversation survive the result URL and reload', async () => {
  window.sessionStorage.clear()
  push.mockReset()
  const task = '11111111-1111-4111-8111-111111111111'
  const project = '22222222-2222-4222-8222-222222222222'
  const from = '33333333-3333-4333-8333-333333333333'
  const expert = 'knowbot:44444444-4444-4444-8444-444444444444@3'
  const fetcher = vi.fn(async () =>
    Response.json({ task_id: task, session_id: task }, { status: 201 }),
  )
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const { result } = renderHook(() => useExpertFinder(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf" locale="zh-CN">
          {children}
        </WorkbenchProvider>
      </QueryClientProvider>
    ),
  })
  await act(async () => {
    await result.current.find({ project, question: '分析营收', from, expert })
  })
  const url = new URL(push.mock.calls.at(-1)![0], 'https://example.test')
  expect(url.searchParams.get('expert')).toBe(expert)
  expect(url.searchParams.get('from')).toBe(from)
  expect(url.searchParams.get('match')).toBe(task)
})
