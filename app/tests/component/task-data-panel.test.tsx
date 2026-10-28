import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskDataPanel } from '@/components/workbench/task-data-panel'
import type { TaskData } from '@/contracts/workbench-v2'
import { ProjectScreen } from '@/features/projects'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

type Call = { method: string; path: string; body: unknown }
let calls: Call[] = []
let replies: Record<string, unknown> = {}

beforeEach(() => {
  calls = []
  replies = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input).split('?')[0]
      const method = init.method ?? 'GET'
      calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined })
      const body = replies[`${method} ${path}`] ?? (method === 'GET' ? null : { status: 'ready' })
      return new Response(JSON.stringify(body ?? { code: 'not_found' }), {
        status: body ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function wrap(children: React.ReactNode) {
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

const TASK = '11111111-1111-4111-8111-111111111111'
const proposed: TaskData = {
  listed: true,
  status: 'ready',
  confirm_in: 'here',
  waiting_for: [],
  incomplete: [],
  pinned: [{ name: '专家自带的资料', need: null }],
  requests: [
    {
      id: 'r1',
      labels: ['最近一年的年报', '上一年比较'],
      status: 'pending',
      missing: [],
      needs: [
        {
          key: 'req1_1',
          name: '最近一年的年报',
          subject: '600519.SH',
          doc_type: 'annual_report',
          period: { kind: 'fixed', start: '2025-01-01', end: '2025-12-31' },
          required: true,
          reading: 'pages',
          description: '',
        },
        {
          key: 'req1_2',
          name: '上一年比较',
          subject: '600519.SH',
          doc_type: 'annual_report',
          period: { kind: 'fixed', start: '2024-01-01', end: '2024-12-31' },
          required: false,
          reading: 'pages',
          description: '',
        },
      ],
      items: [
        {
          ref: 'req1_1:a',
          need_key: 'req1_1',
          key: {
            subject: '600519.SH',
            doc_type: 'annual_report',
            period_start: '2025-01-01',
            period_end: '2025-12-31',
          },
          status: 'resolved',
          chosen: [
            {
              material_id: 'm-2025',
              version_no: 1,
              basis: 'public',
              name: '贵州茅台2025年年度报告.pdf',
            },
          ],
          candidates: [],
          reason: null,
        },
        {
          ref: 'req1_2:b',
          need_key: 'req1_2',
          key: {
            subject: '600519.SH',
            doc_type: 'annual_report',
            period_start: '2024-01-01',
            period_end: '2024-12-31',
          },
          status: 'to_confirm',
          chosen: [],
          candidates: [],
          reason: null,
        },
      ],
    },
  ],
}

describe('确认专家提出的数据（decisions ⑭）', () => {
  it('列出每一样；去掉一样、改主体后确认，带上改过的整份', async () => {
    wrap(<TaskDataPanel task={TASK} data={proposed} />)
    const panel = within(screen.getByTestId('task-data-request'))
    expect(panel.getByText('最近一年的年报')).toBeInTheDocument()
    expect(panel.getByText('600519.SH · 2025 · 必需')).toBeInTheDocument()
    expect(panel.getByText('贵州茅台2025年年度报告.pdf')).toBeInTheDocument()
    expect(panel.getByText('缺，要去取')).toBeInTheDocument()
    // 改第二样的主体
    fireEvent.click(panel.getAllByRole('button', { name: '改' })[1])
    fireEvent.change(panel.getByRole('textbox', { name: '主体' }), {
      target: { value: '000858.sz' },
    })
    fireEvent.click(panel.getByRole('button', { name: '好' }))
    expect(panel.getByText('改过，确认时重新找')).toBeInTheDocument()
    fireEvent.click(panel.getByRole('button', { name: '确认，去取' }))
    await waitFor(() => expect(calls.some((each) => each.method === 'POST')).toBe(true))
    const sent = calls.find((each) => each.method === 'POST')!
    expect(sent.path).toBe(`/api/workbench/tasks/${TASK}/data-requests/confirm`)
    expect((sent.body as { needs: { subject: string }[] }).needs.map((n) => n.subject)).toEqual([
      '600519.SH',
      '000858.SZ',
    ])
  })

  it('只去掉一样：带去掉的条目编号；都不要也行', async () => {
    wrap(<TaskDataPanel task={TASK} data={proposed} />)
    const panel = within(screen.getByTestId('task-data-request'))
    fireEvent.click(panel.getAllByRole('button', { name: '不要这一样' })[1])
    fireEvent.click(panel.getByRole('button', { name: '确认，去取' }))
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0].body).toEqual({ dropped: ['req1_2:b'] })
    fireEvent.click(panel.getByRole('button', { name: '都不要，照现有的做' }))
    await waitFor(() =>
      expect(calls.at(-1)!.path).toBe(`/api/workbench/tasks/${TASK}/data-requests/decline`),
    )
  })

  it('没取到的：写明缺什么，用户定照现有的接着做', async () => {
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          requests: [
            { ...proposed.requests[0], status: 'missing', missing: ['上一年比较：没取到'] },
          ],
        }}
      />,
    )
    const missing = within(screen.getByTestId('task-data-missing'))
    expect(missing.getByText('这几样没取到：上一年比较：没取到。')).toBeInTheDocument()
    fireEvent.click(missing.getByRole('button', { name: '照现有的接着做' }))
    await waitFor(() => expect(calls[0].path).toMatch(/data-requests\/decline$/))
  })
})

describe('测试委托（SDD 0046 第三节）', () => {
  it('提出的数据去 knowlab 确认，这里不给确认按钮', () => {
    wrap(<TaskDataPanel task={TASK} data={{ ...proposed, confirm_in: 'knowlab' }} />)
    expect(screen.getByTestId('task-data-elsewhere')).toHaveTextContent(
      '这是一次测试：专家要 最近一年的年报、上一年比较，去 knowlab 的测试页确认。',
    )
    expect(screen.queryByRole('button', { name: '确认，去取' })).toBeNull()
  })
})

describe('项目看板（请专家方案设计第 4.8 节）', () => {
  it('委托按列排，等你确认数据的在卡片上直接确认', async () => {
    const PROJECT = '22222222-2222-4222-8222-222222222222'
    replies[`GET /api/workbench/projects/${PROJECT}`] = {
      project: {
        id: PROJECT,
        environment_id: '33333333-3333-4333-8333-333333333333',
        workspace_root: '/w',
        path: 'p',
        title: '茅台',
        directory: '/w/p',
        archived: false,
        conversations: 1,
        last_active_at: null,
        environment_name: '我的电脑',
        online: true,
      },
      conversations: [],
      tasks: [
        {
          id: TASK,
          session_id: '44444444-4444-4444-8444-444444444444',
          question: '分析茅台',
          expert: '财务分析与预测',
          state: 'WAITING',
          state_word: null,
          spent: '0',
          currency: 'CNY',
          created_at: '2026-10-28T00:00:00Z',
          ended_at: null,
        },
      ],
      active_task_id: TASK,
    }
    replies[`GET /api/workbench/projects/${PROJECT}/board`] = {
      project_id: PROJECT,
      columns: [
        { key: 'queued', cards: [] },
        { key: 'running', cards: [] },
        {
          key: 'waiting_you',
          cards: [
            {
              task_id: TASK,
              session_id: '44444444-4444-4444-8444-444444444444',
              question: '分析茅台',
              expert: '财务分析与预测',
              state: 'WAITING',
              state_word: null,
              waiting: { who: 'you', what: 'confirm_data' },
            },
          ],
        },
        { key: 'waiting_others', cards: [] },
        { key: 'done', cards: [] },
        { key: 'ended', cards: [] },
      ],
    }
    replies[`GET /api/workbench/tasks/${TASK}/data`] = proposed
    wrap(<ProjectScreen project={PROJECT} />)
    fireEvent.click(await screen.findByRole('button', { name: '看板' }))
    const board = await screen.findByTestId('project-board')
    const waiting = within(within(board).getByRole('region', { name: '等你' }))
    expect(waiting.getByText('分析茅台')).toBeInTheDocument()
    expect(waiting.getByText('等你：确认要用的数据')).toBeInTheDocument()
    fireEvent.click(await waiting.findByRole('button', { name: '确认，去取' }))
    await waitFor(() =>
      expect(calls.some((each) => each.path.endsWith('/data-requests/confirm'))).toBe(true),
    )
  })
})
