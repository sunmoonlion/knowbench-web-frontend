import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationView } from '@/app/[locale]/(dashboard)/workbench/projects/[project]/c/[conversation]/conversation-view'
import { MemoryScreen } from '@/features/memory/ui/memory-screen'
import { ChatScreen } from '@/features/chat'
import { CostLine } from '@/features/usage'
import { WorkbenchProvider } from '@/lib/workbench/context'
import { ConversationEventsProvider } from '@/lib/workbench/conversation-events'
import messages from '@/messages/zh-CN.json'

const replaced = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaced }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/zh-CN/workbench',
}))

// 样例：不属于项目的那段聊天（真后端录的）
const full = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as {
  pages: { title: string; path: string }[]
  responses: { method: string; path: string; file: string }[]
}
const CHAT = manifest.pages
  .find((page) => page.title.startsWith('聊天（不属于项目'))!
  .path.split('/')
  .pop()!
const IN_PROJECT = manifest.pages
  .find((page) => page.title.startsWith('项目里的聊天'))!
  .path.split('/')
  .pop()!

function sample(path: string): unknown {
  const found = manifest.responses.find((each) => each.method === 'GET' && each.path === path)
  return found ? JSON.parse(readFileSync(join(full, found.file), 'utf8')) : null
}

class FakeEventSource {
  static last: FakeEventSource | null = null
  onopen: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeEventSource.last = this
    queueMicrotask(() => this.onopen?.())
  }
  close() {}
}

type Call = { method: string; path: string; body: unknown; csrf: string | null }
let calls: Call[] = []
let events: unknown[] | null = null

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  replaced.mockClear()
  calls = []
  events = null
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
      if (method !== 'GET') return answer({ request_id: 'r', ok: true }, 202)
      if (path.endsWith('/events') && events) return answer({ events, next_cursor: null })
      const body = sample(path)
      return body ? answer(body) : answer({ code: 'not_found' }, 404)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function page(conversation: string = CHAT, content?: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-for-test" locale="zh-CN">
          {content ?? (
            <ConversationEventsProvider conversation={conversation}>
              <ChatScreen
                conversation={conversation}
                cost={<CostLine conversation={conversation} />}
              />
            </ConversationEventsProvider>
          )}
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

function event(cursor: number, type: string, payload: Record<string, unknown>) {
  return {
    id: `00000000-0000-4000-8000-${String(cursor).padStart(12, '0')}`,
    session_id: CHAT,
    cursor,
    kind: 'x',
    type,
    payload,
    task_id: null,
    attempt_id: null,
    created_at: '2026-10-04T00:00:00Z',
  }
}

describe('聊天页', () => {
  it('挂在项目下的聊天有右栏：只读看文件，没有「改动」「终端」；不属于项目的没有右栏（0017，所有者 2026-10-18；终端 10-23 去掉）', async () => {
    page(IN_PROJECT)
    const rail = await screen.findByRole('complementary', { name: '结果' })
    expect(within(rail).getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: '终端' })).toBeNull()
    expect(within(rail).queryByRole('button', { name: '改动' })).toBeNull()
    // 窗口窄于 1024 也不整个藏起来（原来是 lg 才显示）
    expect(rail.className).toContain('sm:flex')
    expect(rail.className).not.toContain('lg:flex')
    cleanup()
    page()
    await screen.findByRole('textbox')
    expect(screen.queryByRole('complementary', { name: '结果' })).toBeNull()
  })

  it('一段答完了的聊天：三轮、花了多少', async () => {
    page()
    expect(await screen.findByText('片仔癀 2025 年的毛利率是多少？')).toBeInTheDocument()
    // 第一句话出现两处：气泡里，和顶部的标题（对话的名字默认取第一句话）
    await waitFor(() =>
      expect(screen.getAllByText('毛利率和净利率有什么区别？用三句话说清楚。')).toHaveLength(2),
    )
    // 「没有数据」卡片已删（decisions 10-29「发版前补齐」①）：查不到的照模型的回答说
    expect(screen.queryByText('600436 的数据还没有入库')).toBeNull()
    // 过程收成一行；模型的思考不出现
    expect(screen.getByRole('button', { name: /查了 1 次数据/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('The user is asking')
    // 输入框下面的花费小字：三次调用相加，和后端的合计一样
    const usage = sample(`/api/workbench/sessions/${CHAT}/usage`) as { cost: string }
    expect(screen.getByTestId('cost-amount').textContent).toBe(`¥${Number(usage.cost).toFixed(3)}`)
    // 都答完了：是发送钮，不是停止钮
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    // 标题和「未归入项目」
    await waitFor(() => expect(screen.getByText('未归入项目')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '放进项目' })).toBeInTheDocument()
  })

  it('正在答的时候：说得出在干什么，发送钮变成停止钮，点了就停', async () => {
    events = [
      event(1, 'turn/requested', { request_id: 'r1', text: '宁德时代的毛利率？', by: 'user' }),
      event(2, 'turn/accepted', { request_id: 'r1', turn: { id: 't1' } }),
      event(3, 'turn/started', { turn: { id: 't1' } }),
      event(4, 'item/started', {
        turnId: 't1',
        item: { type: 'mcpToolCall', id: 'c1', server: 's', tool: 'query', arguments: {} },
      }),
    ]
    page()
    expect(await screen.findByText(/在查数据/)).toBeInTheDocument()
    const stop = screen.getByRole('button', { name: '停止' })
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    // 专家、转为工作在答的时候点不了
    expect(screen.getByRole('button', { name: '转为工作' })).toBeDisabled()

    fireEvent.click(stop)
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/interrupt'))).toBe(true))
    const sent = calls.find((call) => call.path.endsWith('/interrupt'))!
    // 不用说停哪一轮；带着 CSRF
    expect(sent).toMatchObject({ method: 'POST', body: {}, csrf: 'csrf-for-test' })

    // 实时流里来了「被停下」：停止钮变回发送钮，页面说这一轮被停下了
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull())
    act(() => {
      FakeEventSource.last!.onmessage!({
        data: JSON.stringify(
          event(5, 'turn/completed', { turn: { id: 't1', status: 'interrupted' } }),
        ),
      })
    })
    expect(await screen.findByText('这一轮被你停下了。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
  })

  it('发一句话：发到这段对话，发出去之后输入框清空', async () => {
    page()
    await screen.findByText('片仔癀 2025 年的毛利率是多少？')
    const box = screen.getByRole('textbox', { name: '对它说' })
    fireEvent.change(box, { target: { value: '那净利率呢？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/turns'))).toBe(true))
    expect(calls.find((call) => call.path.endsWith('/turns'))).toMatchObject({
      method: 'POST',
      body: { text: '那净利率呢？' },
      csrf: 'csrf-for-test',
    })
    await waitFor(() => expect(box).toHaveValue(''))
  })
})

it('retains the unsent second draft when the first send is acknowledged', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  const gate = Promise.withResolvers<void>()
  vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
    if (url.endsWith('/turns')) await gate.promise
    return original(url, options)
  })
  page()
  await screen.findByText('片仔癀 2025 年的毛利率是多少？')
  const box = screen.getByRole('textbox', { name: '对它说' })
  fireEvent.change(box, { target: { value: 'first question' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  fireEvent.change(box, { target: { value: 'second question' } })
  expect(box).toHaveValue('second question')
  await act(async () => gate.resolve())
  await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/turns'))).toHaveLength(1))
  expect(box).toHaveValue('second question')
  expect(calls.filter((c) => c.path.endsWith('/turns')).map((c) => c.body)).toEqual([
    { text: 'first question', request_id: expect.any(String) },
  ])
})

it('offers retry after the projects service fails', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  let failed = false
  vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
    if (url.split('?')[0].endsWith('/projects')) {
      failed = true
      return answer({ code: 'unavailable' }, 503)
    }
    return original(url, options)
  })
  page()
  fireEvent.click(await screen.findByRole('button', { name: '放进项目' }))
  expect(await screen.findByText(messages.projectPicker.failed)).toBeVisible()
  expect(failed).toBe(true)
})

it('checks project membership before opening the event stream', async () => {
  page(IN_PROJECT, <ConversationView project="different-project" conversation={IN_PROJECT} />)
  expect(await screen.findByRole('alert')).toHaveTextContent(messages.chat.unavailable)
  expect(calls.some((row) => row.path.endsWith('/events'))).toBe(false)
})

it('distinguishes a failed memory read and keeps edits typed while saving', async () => {
  const m = messages.memory
  const pending = Promise.withResolvers<void>()
  const row = {
    id: 'ffea6766-5b87-4d3f-8232-44d969e5d9ba',
    kind: 'fact',
    text: 'saved',
    enabled: true,
    created_at: '2026-11-28T00:00:00Z',
    updated_at: '2026-11-28T00:00:00Z',
  }
  let available = false
  const service = vi.fn(async (_url: string, opts: RequestInit = {}) => {
    if ((opts.method ?? 'GET') === 'GET')
      return available ? answer({ memories: [row] }) : answer({}, 503)
    await pending.promise
    return answer({ memory: row })
  })
  vi.stubGlobal('fetch', service)
  page(CHAT, <MemoryScreen />)
  expect(await screen.findByRole('alert')).toHaveTextContent(m.readFailed)
  available = true
  fireEvent.click(screen.getByRole('button', { name: m.retry }))
  await screen.findByText('saved')
  const box = screen.getByLabelText(m.addLabel)
  fireEvent.change(box, { target: { value: 'first' } })
  fireEvent.click(screen.getByRole('button', { name: m.add }))
  fireEvent.change(box, { target: { value: 'second' } })
  await act(async () => pending.resolve())
  await waitFor(() => expect(screen.getByRole('button', { name: m.add })).toBeEnabled())
  expect(box).toHaveValue('second')
})

it('navigates a chat to its assigned project after the server accepts it', async () => {
  const list = sample('/api/workbench/projects') as {
    projects: { id: string; title: string; archived: boolean }[]
  }
  const first = list.projects.find((row) => !row.archived)!
  page()
  fireEvent.click(await screen.findByRole('button', { name: '放进项目' }))
  const dialog = within(await screen.findByRole('dialog'))
  fireEvent.click(await dialog.findByRole('button', { name: new RegExp(first.title) }))
  await waitFor(() =>
    expect(replaced).toHaveBeenCalledWith('/zh-CN/workbench/projects/' + first.id + '/c/' + CHAT),
  )
  expect(calls.find((c) => c.path.endsWith('/project'))?.body).toEqual({ project_id: first.id })
})
