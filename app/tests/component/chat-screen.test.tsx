import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatScreen } from '@/features/chat'
import { CostLine } from '@/features/usage'
import { WorkbenchProvider } from '@/lib/workbench/context'
import { ConversationEventsProvider } from '@/lib/workbench/conversation-events'
import messages from '@/messages/zh-CN.json'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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

function page(conversation: string = CHAT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-for-test" locale="zh-CN">
          <ConversationEventsProvider conversation={conversation}>
            <ChatScreen
              conversation={conversation}
              cost={<CostLine conversation={conversation} />}
            />
          </ConversationEventsProvider>
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
  it('挂在项目下的聊天有右栏：只读看文件、终端，没有「改动」；不属于项目的没有右栏（0017，所有者 2026-10-18）', async () => {
    page(IN_PROJECT)
    const rail = await screen.findByRole('complementary', { name: '结果' })
    expect(within(rail).getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: '终端' })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: '改动' })).toBeNull()
    // 窗口窄于 1024 也不整个藏起来（原来是 lg 才显示）
    expect(rail.className).toContain('sm:flex')
    expect(rail.className).not.toContain('lg:flex')
    cleanup()
    page()
    await screen.findByRole('textbox')
    expect(screen.queryByRole('complementary', { name: '结果' })).toBeNull()
  })

  it('一段答完了的聊天：三轮、没有数据的卡片、花了多少', async () => {
    page()
    expect(await screen.findByText('片仔癀 2025 年的毛利率是多少？')).toBeInTheDocument()
    // 第一句话出现两处：气泡里，和顶部的标题（对话的名字默认取第一句话）
    await waitFor(() =>
      expect(screen.getAllByText('毛利率和净利率有什么区别？用三句话说清楚。')).toHaveLength(2),
    )
    // 没有数据：一张卡片，能去申请入库（链接要等跨应用的地址取到，这里没有，所以是说明）
    expect(screen.getByText('600436 的数据还没有入库')).toBeInTheDocument()
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
