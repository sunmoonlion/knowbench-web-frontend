import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AskExpertScreen } from '@/features/expert'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const push = vi.fn()
let search = ''

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/zh-CN/workbench/expert',
}))

const full = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as {
  pages: { title: string; path: string }[]
  responses: { method: string; path: string; query: string; file: string }[]
}
function sample(path: string): unknown {
  const found = manifest.responses.find((each) => each.method === 'GET' && each.path === path)
  return found ? JSON.parse(readFileSync(join(full, found.file), 'utf8')) : null
}
const project = manifest.pages.find((page) => page.title.startsWith('项目页'))!.path.split('/')[4]

type Call = { method: string; path: string; body: Record<string, unknown> }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  search = ''
  push.mockReset()
  window.sessionStorage.clear()
  window.sessionStorage.setItem('workbench.question', '看看这家公司这几年的年报')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input).split('?')[0]
      if (path === '/api/workbench/expert/entry') return Response.json({ unified: true })
      const method = init.method ?? 'GET'
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      if (method !== 'GET') {
        calls.push({ method, path, body: JSON.parse(String(init.body ?? '{}')) })
        return json(
          {
            task_id: '11111111-1111-4111-8111-111111111111',
            session_id: '22222222-2222-4222-8222-222222222222',
          },
          201,
        )
      }
      if (path === '/api/web/v1/cross-app/links')
        return json({
          app: 'knowbench',
          targets: {
            knowlab: { web_base_url: 'https://knowlab.example.test' },
            knowmart: { web_base_url: 'https://knowmart.example.test' },
          },
        })
      if (path.startsWith('/api/workbench/find-expert/')) {
        return json({
          task_id: '11111111-1111-4111-8111-111111111111',
          project_id: project,
          question: '看看这家公司这几年的年报',
          state: 'RUNNING',
        })
      }
      const body = sample(path)
      return json(body ?? { code: 'not_found' }, body ? 200 : 404)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function page(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-for-test" locale="zh-CN">
          {children}
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('请专家：数据按问题定', () => {
  it('空问题只有请专家入口，不创建申请或收费任务', async () => {
    window.sessionStorage.clear()
    page(<AskExpertScreen project={project} from={null} />)
    expect(await screen.findByRole('button', { name: '请专家' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: '去knowlab提交创意' })).toBeNull()
    expect(screen.queryByRole('link', { name: '自己去knowmart请专家' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'ai去knowmart请回专家' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('项目已有分析任务仍可查找，查找不会同时提交分析', async () => {
    const original = global.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        if (
          String(input).split('?')[0] === `/api/workbench/projects/${project}` &&
          (init.method ?? 'GET') === 'GET'
        ) {
          return new Response(
            JSON.stringify({
              ...(sample(`/api/workbench/projects/${project}`) as object),
              active_task_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            }),
          )
        }
        return original(input, init)
      }),
    )
    page(<AskExpertScreen project={project} from={null} />)
    const start = screen.getByRole('button', { name: '请专家' })
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].path).toBe(`/api/workbench/projects/${project}/find-expert`)
  })

  it('按原问题发起一次正式匹配并写入可恢复的委托地址', async () => {
    page(<AskExpertScreen project={project} from={null} />)
    const find = await screen.findByRole('button', { name: '请专家' })
    await waitFor(() => expect(find).toBeEnabled())
    fireEvent.click(find)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].path).toBe(`/api/workbench/projects/${project}/find-expert`)
    expect(calls[0].body).toMatchObject({
      question: '看看这家公司这几年的年报',
      match_contract: 'knowbench/expert-match/v5',
      retain_empty: true,
    })
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get('formalMatch')).toBe(
        '11111111-1111-4111-8111-111111111111',
      ),
    )
  })
})
