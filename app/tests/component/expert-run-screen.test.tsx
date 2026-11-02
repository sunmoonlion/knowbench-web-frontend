import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Run } from '@/contracts/workbench-v2'

import { ExpertRunScreen } from '@/features/expert'
import { WorkbenchProvider } from '@/lib/workbench/context'
import { ConversationEventsProvider } from '@/lib/workbench/conversation-events'
import messages from '@/messages/zh-CN.json'
import backendFixture from '@/tests/fixtures/knowbase-run.json'
import dynamicFixture from '@/tests/fixtures/dynamic-run.json'
import { runSchema } from '@/contracts/workbench-v2'

const full = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as {
  pages: { title: string; path: string }[]
  responses: { method: string; path: string; query: string; file: string }[]
}
function sample(path: string, query?: string): unknown {
  const found = manifest.responses.find(
    (each) =>
      each.method === 'GET' && each.path === path && (query === undefined || each.query === query),
  )
  return found ? JSON.parse(readFileSync(join(full, found.file), 'utf8')) : null
}
const conversationOf = (title: string) =>
  manifest.pages
    .find((page) => page.title.startsWith(title))!
    .path.split('/')
    .pop()!
const taskOf = (conversation: string) =>
  (sample('/api/workbench/tasks', `session_id=${conversation}`) as { tasks: { id: string }[] })
    .tasks[0].id

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
let withoutNow = false
let supplyingData = false
let withKnowbase = false
let methodView: Run | null = null

beforeEach(() => {
  calls = []
  withoutNow = false
  supplyingData = false
  withKnowbase = false
  methodView = null
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
      let body = method === 'GET' ? sample(path) : { ok: true }
      if (withKnowbase && method === 'GET' && path.endsWith('/steps')) body = backendFixture.steps
      if (withKnowbase && method === 'GET' && path.endsWith('/data')) body = backendFixture.data
      if (methodView && method === 'GET') {
        if (path.endsWith('/steps')) body = methodView
        const selected = path.match(/\/steps\/(\d+)$/)
        if (selected) body = { step: methodView.steps[Number(selected[1]) - 1] }
      }
      if (supplyingData && method === 'GET' && path.endsWith('/steps') && body) {
        const run = body as Run
        body = {
          ...run,
          task: { ...run.task, state: 'WAITING', waiting_reason: 'DATA' },
          now: run.now && {
            ...run.now,
            held: false,
            doing: { code: 'supplying', text: '采单已确认，正在等待数据服务完成采集与加工' },
          },
        }
      }
      if (withoutNow && method === 'GET' && path.endsWith('/steps') && body) {
        body = { ...body, now: null }
      }
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
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-for-test" locale="zh-CN">
          <ConversationEventsProvider conversation={conversation}>
            <ExpertRunScreen task={taskOf(conversation)} />
          </ConversationEventsProvider>
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('专家处理中', () => {
  it('accepts the backend dynamic view and shows selected methods and reasons', async () => {
    methodView = runSchema.parse(dynamicFixture)
    page(conversationOf('专家处理中'))
    expect(await screen.findByText('任务计划 · 第 1 版')).toBeInTheDocument()
    expect(await screen.findByText(/当前有效成果：第 1 版/)).toBeInTheDocument()
    expect(screen.getByText(/本次选择这个方法的原因/)).toBeInTheDocument()
  })

  it('shows planning with no invented step or detail request', async () => {
    const view = runSchema.parse(dynamicFixture)
    methodView = {
      ...view,
      task: {
        ...view.task,
        state: 'RUNNING',
        plan: { version: null, planning: true, reason: null, history: [] },
      },
      steps: [],
      position: null,
    }
    page(conversationOf('专家处理中'))
    expect(await screen.findByText('正在安排方法与顺序')).toBeInTheDocument()
    expect(calls.some((call) => /\/steps\/\d+$/.test(call.path))).toBe(false)
  })

  it('retains plan revision reasons and distinguishes historical accepted results', async () => {
    const view = runSchema.parse(dynamicFixture)
    methodView = {
      ...view,
      task: {
        ...view.task,
        plan: {
          version: 2,
          planning: false,
          reason: '重新绑定已验收的输入',
          history: [
            { version: 1, reason: '初次安排' },
            { version: 2, reason: '重新绑定已验收的输入' },
          ],
        },
      },
      steps: view.steps.map((step) => ({ ...step, current_result: null })),
    }
    page(conversationOf('专家处理中'))
    expect(await screen.findByText('任务计划 · 第 2 版', { selector: 'p' })).toBeInTheDocument()
    expect(await screen.findByText(/下方保留的是历史成果/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('查看计划调整记录'))
    expect(screen.getByText(/初次安排/)).toBeVisible()
  })
  it('真实后端非空资料库响应仍展示步骤和待确认采单，不自动确认', async () => {
    withKnowbase = true
    page(conversationOf('专家处理中'))
    expect(await screen.findByText(/专家自带的资料（资料库）/)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '步骤' })).toBeInTheDocument()
    expect(await screen.findByText('上一年比较')).toBeInTheDocument()
    expect(screen.queryByText('没有取到这件委托。')).not.toBeInTheDocument()
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('采单确认后等待数据服务，不再提示用户决定或沙箱掉线', async () => {
    supplyingData = true
    page(conversationOf('专家处理中'))
    expect(await screen.findByText('采单已确认，等待数据服务完成')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('采单已确认')
    expect(screen.queryByText('专家停下来了，等你决定')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止' })).toBeEnabled()
  })

  it('一直摆着：做到第几步、花了多少、现在在干什么、为什么', async () => {
    page(conversationOf('专家处理中'))
    expect(await screen.findByText('专家正在处理：问数')).toBeInTheDocument()
    expect(screen.getByText('第 3 步，共 5 步：执行 SQL')).toBeInTheDocument()
    expect(screen.getByTestId('run-spent')).toHaveTextContent('已花 ¥0.150')
    const now = within(screen.getByRole('region', { name: '现在' }))
    expect(now.getByRole('status')).toHaveTextContent('在想这一步怎么做')
    expect(now.getByText(/查询的结果原样带回/)).toBeInTheDocument()
    expect(now.getByText(/这一步已经做了/)).toBeInTheDocument()
    // 步骤轨：前两步通过，第三步在做，后面的还没做
    const rail = within(screen.getByRole('navigation', { name: '步骤' }))
    expect(rail.getByRole('button', { name: /1 改写问题/ })).toHaveAttribute('title', '通过')
    expect(rail.getByRole('button', { name: /3 执行 SQL/ })).toHaveAttribute('title', '在做')
    expect(rail.getByRole('button', { name: /5 成稿/ })).toHaveAttribute('title', '还没做')
    // 右边是和工作页同一个边栏（0015 §3.2）：平时折叠成一条，点「改动」才开；没有「底稿」字样
    const strip = screen.getByRole('complementary', { name: '结果' })
    expect(strip).toHaveAttribute('data-state', 'collapsed')
    fireEvent.click(within(strip).getByRole('button', { name: '改动' }))
    const panel = screen.getByRole('complementary', { name: '结果' })
    expect(panel).toHaveAttribute('data-state', 'open')
    expect(within(panel).getByRole('region', { name: '改动' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('底稿')
  })

  it('点别的步骤看它交回了什么、验收的每一条', async () => {
    page(conversationOf('专家处理中'))
    fireEvent.click(await screen.findByRole('button', { name: /2 生成 SQL/ }))
    expect(await screen.findByRole('heading', { name: '生成 SQL' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/SELECT fiscal_year/)).toBeInTheDocument())
    expect(screen.getByText('查询语句不是空的')).toBeInTheDocument()
  })

  it('停止：先问一句，写明已花的不退；确认才停', async () => {
    const conversation = conversationOf('专家处理中')
    page(conversation)
    fireEvent.click(await screen.findByRole('button', { name: '停止' }))
    expect(await screen.findByText('停下专家？')).toBeInTheDocument()
    expect(screen.getByText(/已经花的不退/)).toBeInTheDocument()
    expect(calls.some((call) => call.path.endsWith('/cancel'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '停下' }))
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/cancel'))).toBe(true))
    expect(calls.find((call) => call.path.endsWith('/cancel'))).toMatchObject({
      method: 'POST',
      path: `/api/workbench/tasks/${taskOf(conversation)}/cancel`,
      csrf: 'csrf-for-test',
    })
    // 那一轮还没收住时：顶上马上说「正在停下」，按钮变灰，不让人以为没点上（2026-10-14）
    expect(await screen.findByText(/正在停下/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停下中…' })).toBeDisabled()
  })

  it('等待环境恢复时，即使 now 快照缺失也能停止，不依赖机器连接', async () => {
    withoutNow = true
    const conversation = conversationOf('专家停下来了：勾稽不平')
    page(conversation)
    fireEvent.click(await screen.findByRole('button', { name: '停止' }))
    fireEvent.click(await screen.findByRole('button', { name: '停下' }))
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/cancel'))).toBe(true))
    expect(calls.find((call) => call.path.endsWith('/cancel'))?.csrf).toBe('csrf-for-test')
  })

  it('专家停下来问我：哪条没过、每个选项选了会怎样；答复带着凭证', async () => {
    page(conversationOf('专家停下来了：勾稽不平'))
    expect(await screen.findByText('专家停下来了，等你决定')).toBeInTheDocument()
    const review = within(await screen.findByRole('region', { name: '第「勾稽」步没有通过验收' }))
    expect(review.getByText('每条勾稽规则都平')).toBeInTheDocument()
    // 「选了会怎样」是后端写的
    expect(review.getByText(/专家重做这一步/)).toBeInTheDocument()
    expect(review.getByText(/把做完的 2 步交回给你/)).toBeInTheDocument()
    expect(review.getByText(/过期不等于同意/)).toBeInTheDocument()
    fireEvent.click(review.getByRole('button', { name: '再试一次' }))
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/respond'))).toBe(true))
    const sent = calls.find((call) => call.path.endsWith('/respond'))!
    expect(sent).toMatchObject({ method: 'POST', csrf: 'csrf-for-test' })
    expect(sent.body).toMatchObject({ decision: 'rework' })
    expect((sent.body as { token: string }).token.length).toBeGreaterThan(16)
    // 等你决定的时候不说「还在进行」
    expect(screen.queryByText(/这一步已经做了/)).toBeNull()
  })
})
