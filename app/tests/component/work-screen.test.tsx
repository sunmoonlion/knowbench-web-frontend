import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkScreen } from '@/features/work'
import { WorkbenchProvider } from '@/lib/workbench/context'
import { ConversationEventsProvider } from '@/lib/workbench/conversation-events'
import messages from '@/messages/zh-CN.json'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/zh-CN/workbench',
}))

const full = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as {
  pages: { title: string; path: string }[]
  responses: { method: string; path: string; file: string }[]
}
const idOf = (title: string) =>
  manifest.pages
    .find((page) => page.title.startsWith(title))!
    .path.split('/')
    .pop()!

function sample(path: string): unknown {
  const found = manifest.responses.find((each) => each.method === 'GET' && each.path === path)
  return found ? JSON.parse(readFileSync(join(full, found.file), 'utf8')) : null
}

class FakeEventSource {
  onopen: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    queueMicrotask(() => this.onopen?.())
  }
  close() {}
}

type Call = { method: string; path: string; body: unknown; csrf: string | null }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input).split('?')[0]
      const method = init.method ?? 'GET'
      const headers = (init.headers ?? {}) as Record<string, string>
      calls.push({
        method,
        path,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        csrf: headers['X-CSRF-Token'] ?? null,
      })
      const body = method === 'GET' ? sample(path) : { ok: true }
      return new Response(JSON.stringify(body ?? { code: 'not_found' }), {
        status: body ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function page(conversation: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-for-test" locale="zh-CN">
          <ConversationEventsProvider conversation={conversation}>
            <WorkScreen conversation={conversation} />
          </ConversationEventsProvider>
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('工作页', () => {
  it('过程收成一行，改了的文件摆在外面，右边有「改动」', async () => {
    page(idOf('工作（'))
    // 它说的那句话是一段过程的标题，后面写着跑了几条命令；命令本身收着
    const phase = await screen.findByRole('button', { name: /我先看一下当前目录结构.*2 条命令/ })
    expect(screen.queryByText('ls -la')).toBeNull()
    fireEvent.click(phase)
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    // 右边的结果边栏：还在等批准，没做完，折叠着；点开里面是「改动」
    expect(screen.getByRole('complementary', { name: '结果' })).toHaveAttribute(
      'data-state',
      'collapsed',
    )
    fireEvent.click(
      within(screen.getByRole('complementary', { name: '结果' })).getByRole('button', {
        name: '改动',
      }),
    )
    const results = screen.getByRole('complementary', { name: '结果' })
    expect(results).toHaveAttribute('data-state', 'open')
    // 用补丁改的两个文件：时间线里一处，「改动」栏里一处
    expect(screen.getAllByRole('button', { name: /新建\s*notes\/待办\.md/ })).toHaveLength(2)
    const panel = within(within(results).getByRole('region', { name: '改动' }))
    expect(panel.getByText('2 个文件')).toBeInTheDocument()
    expect(panel.getByText('README.md')).toBeInTheDocument()
    // 点开看改了什么
    fireEvent.click(panel.getByText('README.md'))
    expect(panel.getByText('+# 恒瑞医药研究笔记')).toBeInTheDocument()
    // 活动行在时间线末尾：它在等我批准。顶栏没有状态带了
    expect(screen.getByRole('status')).toHaveTextContent('在等你批准')
    expect(document.body.textContent).not.toContain('你在操作')
  })

  it('等批准的命令：把命令、目录、理由摆出来；点「拒绝这一步」，带着凭证答复', async () => {
    const id = idOf('工作（')
    page(id)
    const card = await screen.findByRole('region', {
      name: '它要做的这件事超出了允许的范围，要你点头',
    })
    expect(card).toHaveTextContent('outside.txt')
    expect(card).toHaveTextContent('/home/demo/research/恒瑞医药')
    // 能选什么、怎么说，是后端给的
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '允许一次' })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: '拒绝这一步' }))
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/respond'))).toBe(true))
    const view = sample(`/api/workbench/sessions/${id}`) as {
      pending_interactions: { id: string }[]
    }
    const sent = calls.find((call) => call.path.endsWith('/respond'))!
    expect(sent.path).toBe(`/api/workbench/interactions/${view.pending_interactions[0].id}/respond`)
    expect(sent).toMatchObject({ method: 'POST', csrf: 'csrf-for-test' })
    expect(sent.body).toMatchObject({ decision: 'decline' })
    expect((sent.body as { token: string }).token.length).toBeGreaterThan(16)
  })

  it('专家正在处理：输入框禁用并写明原因；专家交回的原样不显示', async () => {
    page(idOf('专家处理中'))
    expect(await screen.findByText('交给了专家')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('专家正在处理'))
    const box = screen.getByRole('textbox', { name: '对它说' })
    expect(box).toBeDisabled()
    expect(box).toHaveAttribute('placeholder', '专家正在处理，你可以看进度、答复待办或取消。')
    expect(document.body.textContent).not.toContain('SELECT')
  })
})

it('排队中的专家会话说明原因并链接项目任务，不显示空白未开始', async () => {
  const conversation = idOf('工作（')
  const originalFetch = globalThis.fetch
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      if (String(input).split('?')[0] === `/api/workbench/sessions/${conversation}/events`) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: '00000000-0000-4000-8000-000000000201',
                session_id: conversation,
                cursor: 1,
                kind: 'task',
                type: 'task/queued',
                task_id: '00000000-0000-4000-8000-000000000202',
                attempt_id: null,
                payload: { behind: '00000000-0000-4000-8000-000000000203' },
                created_at: '2026-11-02T02:05:00+08:00',
              },
            ],
            next_cursor: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return originalFetch(input, init)
    }),
  )
  page(conversation)
  expect(await screen.findByText('专家任务已排队')).toBeInTheDocument()
  expect(screen.getByText(/同一项目一次处理一位专家/)).toBeInTheDocument()
  expect(screen.queryByText('还没有开始。')).not.toBeInTheDocument()
  const link = await screen.findByRole('link', { name: '查看项目任务，找到前面的专家' })
  expect(link.getAttribute('href')).toMatch(/^\/zh-CN\/workbench\/projects\//)
  fireEvent.click(screen.getByRole('button', { name: '取消这条排队任务' }))
  await waitFor(() =>
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' &&
          call.path === '/api/workbench/tasks/00000000-0000-4000-8000-000000000202/cancel' &&
          call.csrf === 'csrf-for-test',
      ),
    ).toBe(true),
  )
  expect(
    calls.some((call) => call.path.includes('00000000-0000-4000-8000-000000000203/cancel')),
  ).toBe(false)
})
