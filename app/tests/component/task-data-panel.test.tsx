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
  outputs_not_saved: [],
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
    expect(missing.getByText('上一年比较：没取到')).toBeInTheDocument()
    expect(missing.getByText(/还有 1 项数据未齐/)).toBeInTheDocument()
    expect(missing.getByText('展开缺失项')).toBeInTheDocument()
    fireEvent.click(missing.getByRole('button', { name: '照现有的接着做' }))
    await waitFor(() => expect(calls[0].path).toMatch(/data-requests\/decline$/))
  })
})

describe('预切合与直达上传（SDD 0043 第 3.2、3.3 节）', () => {
  it('要去取的写明能不能取、预计多久、许可档；一共预计多久写在上面', () => {
    const [have, want] = proposed.requests[0].items
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          requests: [
            {
              ...proposed.requests[0],
              eta_seconds: 5400,
              items: [
                have,
                {
                  ...want,
                  prematch: {
                    status: 'available',
                    license: 'via_expert',
                    eta_seconds: 300,
                    readings_missing: [],
                  },
                },
              ],
            },
          ],
        }}
      />,
    )
    expect(screen.getByTestId('task-data-eta')).toHaveTextContent(
      '要去取的预计最多 2 小时（保守地按全部要新取算）。',
    )
    expect(screen.getByTestId('task-data-prematch')).toHaveTextContent(
      '能取 · 预计 5 分钟 · 许可档：可以经专家给别人用',
    )
  })

  it('取不到的写为什么；knowfeed 问不到时不写预计', () => {
    const [have, want] = proposed.requests[0].items
    const { unmount } = wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          requests: [
            {
              ...proposed.requests[0],
              items: [
                have,
                {
                  ...want,
                  prematch: { status: 'unavailable', reason: 'no_channel', readings_missing: [] },
                },
              ],
            },
          ],
        }}
      />,
    )
    expect(screen.getByTestId('task-data-prematch')).toHaveTextContent('取不到：这类数据还取不到')
    unmount()
    wrap(<TaskDataPanel task={TASK} data={proposed} />)
    expect(screen.queryByTestId('task-data-prematch')).toBeNull()
    expect(screen.queryByTestId('task-data-eta')).toBeNull()
  })

  it('采不来的给去 knowbase 直达上传的链接，按描述预填、带委托编号', async () => {
    replies['GET /api/web/v1/cross-app/links'] = {
      app: 'knowbench',
      targets: { knowbase: { web_base_url: 'https://knowbase.example' } },
    }
    const [have, want] = proposed.requests[0].items
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          requests: [
            {
              ...proposed.requests[0],
              items: [have, { ...want, status: 'not_collectable' }],
            },
          ],
        }}
      />,
    )
    const link = await screen.findByRole('link', { name: '去 knowbase 上传' })
    const href = new URL(link.getAttribute('href')!)
    expect(href.origin + href.pathname).toBe('https://knowbase.example/zh-CN/upload')
    expect(Object.fromEntries(href.searchParams)).toEqual({
      doc_type: 'annual_report',
      subject: '600519.SH',
      period_start: '2024-01-01',
      period_end: '2024-12-31',
      from: 'knowbench',
      ref: TASK,
    })
    expect(link).toHaveAttribute('target', '_blank')
  })
})

describe('上传回来与成稿没存进 knowbase（独立审 10-30 第二轮）', () => {
  it('采不来的那一项给「传好了，重新查」，点了请后端重新解析', async () => {
    const [have, want] = proposed.requests[0].items
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          requests: [
            { ...proposed.requests[0], items: [have, { ...want, status: 'not_collectable' }] },
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '传好了，重新查' }))
    await waitFor(() =>
      expect(calls.some((each) => each.path.endsWith('/data-requests/recheck'))).toBe(true),
    )
    expect(calls.find((each) => each.method === 'POST')!.path).toBe(
      `/api/workbench/tasks/${TASK}/data-requests/recheck`,
    )
  })

  it('不限主体的采不来条目不给直达上传，也不给重新查', () => {
    const [have, want] = proposed.requests[0].items
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          requests: [
            {
              ...proposed.requests[0],
              items: [
                have,
                { ...want, status: 'not_collectable', key: { ...want.key, subject: null } },
              ],
            },
          ],
        }}
      />,
    )
    expect(screen.queryByRole('link', { name: '去 knowbase 上传' })).toBeNull()
    expect(screen.queryByRole('button', { name: '传好了，重新查' })).toBeNull()
  })

  it('成稿没存进 knowbase 的写明原因；没有清单的委托也显示', () => {
    const notSaved = [
      { path: '底稿/a/成稿.md', reason: '成稿交付后改过，和交付时的那份对不上，没写' },
    ]
    const { unmount } = wrap(
      <TaskDataPanel task={TASK} data={{ ...proposed, outputs_not_saved: notSaved }} />,
    )
    expect(screen.getByTestId('task-output-not-saved')).toHaveTextContent(
      '这份成稿没存进 knowbase：成稿.md——成稿交付后改过，和交付时的那份对不上，没写',
    )
    unmount()
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          listed: false,
          confirm_in: 'here',
          waiting_for: [],
          incomplete: [],
          requests: [],
          pinned: [],
          outputs_not_saved: notSaved,
        }}
      />,
    )
    expect(screen.getByTestId('task-output-not-saved')).toBeInTheDocument()
  })
})

describe('补采进度', () => {
  it('失败后能在原任务重新核对采单，按钮不直接确认或取数', async () => {
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          requests: proposed.requests.map((r) => ({
            ...r,
            status: 'missing',
            missing: ['上一年报表未取到'],
          })),
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '重新核对采单' }))
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith('/data-requests/recheck'))).toBe(true),
    )
    expect(calls.some((c) => c.path.endsWith('/data-requests/confirm'))).toBe(false)
  })

  it('重新核对遇到服务故障时不归咎于主体年份，也不自动确认', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'user_data_unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          requests: proposed.requests.map((r) => ({
            ...r,
            status: 'missing',
            missing: ['年报未取到'],
          })),
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '重新核对采单' }))
    expect(
      await screen.findByText(messages.expert.data.problems.user_data_unavailable),
    ).toBeInTheDocument()
    expect(screen.queryByText(messages.expert.data.problems.data_choice_invalid)).toBeNull()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      `/api/workbench/tasks/${TASK}/data-requests/recheck`,
    )
    expect(screen.getByRole('button', { name: '重新核对采单' })).toBeEnabled()
  })

  it('按类型分组显示真实状态与失败原因，不重复模型的长理由', () => {
    const reason = '第六步需读年报并写明页码核对'
    const items = [
      { id: 'c1', year: '2024', status: 'ready', reason: null },
      { id: 'c2', year: '2023', status: 'fetching', reason: null },
      { id: 'c3', year: '2022', status: 'failed', reason: 'invalid_request' },
    ].map(({ year, ...item }) => ({
      ...item,
      key: {
        subject: '600519.SH',
        doc_type: 'annual_report',
        period_start: `${year}-01-01`,
        period_end: `${year}-12-31`,
      },
      readings: ['original'],
    }))
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          status: 'waiting',
          requests: [],
          waiting_for: [reason, reason, reason],
          supply_progress: { checked_at: '2026-11-02T00:30:00Z', items },
        }}
      />,
    )
    const panel = screen.getByTestId('supply-progress')
    expect(panel).toHaveTextContent('共 3 项：就绪 1 · 处理中 1 · 部分完成 0 · 未完成 1')
    expect(panel).toHaveTextContent('交付请求不符合接口要求')
    expect(panel).toHaveTextContent('不能仅靠等待保证完成')
    expect(panel).not.toHaveTextContent(reason)
    expect(screen.getAllByText(/600519.SH · 年报/)).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '确认，去取' })).not.toBeInTheDocument()
  })
  it('旧任务没有逐项快照时承认未知，不虚报进度', () => {
    wrap(
      <TaskDataPanel
        task={TASK}
        data={{
          ...proposed,
          status: 'waiting',
          requests: [],
          waiting_for: ['冗长理由一', '冗长理由二'],
        }}
      />,
    )
    expect(screen.getByTestId('supply-progress')).toHaveTextContent('已提交 2 项')
    expect(screen.getByTestId('supply-progress')).toHaveTextContent('暂时没有逐项状态')
    expect(screen.getByTestId('supply-progress')).not.toHaveTextContent('冗长理由')
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
