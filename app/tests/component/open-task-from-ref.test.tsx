import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { taskIdOf, useOpenTaskFromRef } from '@/features/home/api/open-task'
import { WorkbenchProvider } from '@/lib/workbench/context'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }))

const TASK = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const SESSION = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  replace.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ task: { id: TASK, project_id: PROJECT, session_id: SESSION } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    ),
  )
})
afterEach(() => vi.unstubAllGlobals())

function Probe({ value }: { value: string | null }) {
  useOpenTaskFromRef(value)
  return null
}

function mount(value: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WorkbenchProvider csrfToken="csrf" locale="zh-CN">
        <Probe value={value} />
      </WorkbenchProvider>
    </QueryClientProvider>,
  )
}

describe('workbench 页认 ?ref=<委托编号>（knowbase 直达上传传完回来）', () => {
  it('打开那件委托所在的对话', async () => {
    mount(TASK)
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/zh-CN/workbench/projects/${PROJECT}/c/${SESSION}`),
    )
  })

  it('不像委托编号的不去问', () => {
    expect(taskIdOf('knowbench:run:x')).toBeNull()
    expect(taskIdOf(null)).toBeNull()
    expect(taskIdOf(TASK)).toBe(TASK)
    mount('../etc')
    expect(fetch).not.toHaveBeenCalled()
  })
})
