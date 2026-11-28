import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { useStart } from '@/features/home/api/start'
import { WorkbenchProvider } from '@/lib/workbench/context'

afterEach(() => vi.unstubAllGlobals())

it('首句被项目占用拒绝后重试同一会话，不重复创建空会话；换项目才新建', async () => {
  const created: unknown[] = []
  const turns: string[] = []
  const requestIds: string[] = []
  let held = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      if (path === '/api/workbench/sessions') {
        created.push(JSON.parse(String(init.body)))
        return Response.json(
          { session_id: `00000000-0000-4000-8000-00000000000${created.length}` },
          { status: 201 },
        )
      }
      turns.push(path)
      requestIds.push(JSON.parse(String(init.body)).request_id)
      return held
        ? Response.json({ code: 'project_held_by_expert', message: 'held' }, { status: 409 })
        : Response.json(
            { request_id: 'req-1', command_id: '00000000-0000-4000-8000-000000000001', cursor: 1 },
            { status: 202 },
          )
    }),
  )
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const { result } = renderHook(() => useStart(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-test" locale="zh-CN">
          {children}
        </WorkbenchProvider>
      </QueryClientProvider>
    ),
  })
  const input = { kind: 'work' as const, project: 'project-a', text: 'read file' }
  await act(async () => {
    await expect(result.current.mutateAsync(input)).rejects.toMatchObject({
      code: 'project_held_by_expert',
    })
  })
  await act(async () => {
    await expect(result.current.mutateAsync(input)).rejects.toMatchObject({
      code: 'project_held_by_expert',
    })
  })
  expect(created).toHaveLength(1)
  expect(turns[1]).toBe(turns[0])
  expect(requestIds[0]).toBeTruthy()
  expect(requestIds[1]).toBe(requestIds[0])
  held = false
  await act(async () => {
    await result.current.mutateAsync(input)
  })
  expect(created).toHaveLength(1)
  await act(async () => {
    await result.current.mutateAsync({ ...input, project: 'project-b' })
  })
  expect(created).toHaveLength(2)
})
