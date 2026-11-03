// AI 查找只选中，提交问题才创建分析委托；无匹配的出路保持由用户决定。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DirectAnswerNote } from '@/features/chat/ui/direct-answer-note'
import { FindExpertPanel } from '@/features/expert/ui/find-expert-panel'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const push = vi.fn()
const selected = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/zh-CN/workbench/expert',
}))

const TASK = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const MADE = '33333333-3333-4333-8333-333333333333'
const TALK = '44444444-4444-4444-8444-444444444444'
const KNOWBOT = '55555555-5555-4555-8555-555555555555'
const QUESTION = '宁德时代这几年的毛利率怎么变的'

const pick = (free: boolean) => ({
  knowbot_id: KNOWBOT,
  version: '2',
  name: '财务分析与预测',
  tagline: '看三张表',
  price: free ? null : '5.00',
  free,
  reason: '它接财报分析',
})
const PACK = {
  id: `knowbot:${KNOWBOT}@2`,
  name: '财务分析与预测',
  tagline: '看三张表',
  solves: '经营',
  does_not_solve: '买卖建议',
  input: '一个问题',
  output: '成稿',
  uses_our_data: false,
  steps: [],
}

type Call = { method: string; path: string; body: Record<string, unknown> }
let calls: Call[] = []
let result: Record<string, unknown> = {}

beforeEach(() => {
  calls = []
  push.mockReset()
  selected.mockReset()
  window.sessionStorage.clear()
  window.localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input).split('?')[0]
      const method = init.method ?? 'GET'
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      if (method === 'GET') {
        if (path === `/api/workbench/find-expert/${TASK}`) return json(result)
        return json({ code: 'not_found' }, 404)
      }
      calls.push({ method, path, body: JSON.parse(String(init.body ?? '{}')) })
      if (path === '/api/workbench/knowbots/pin') return json({ pack: PACK })
      if (path.endsWith('/delegations')) return json({ task_id: TASK, session_id: MADE }, 201)
      if (path === '/api/workbench/sessions') return json({ session_id: TALK }, 201)
      if (path.endsWith('/turns')) return json({ request_id: 'r1' }, 202)
      if (path.endsWith('/incubation'))
        return json({ request_id: 'req-1', title: '毛利率变化', created: true }, 201)
      if (path.endsWith('/demand')) return json({ demand: { demand_id: 'd-1' } }, 201)
      return json({ code: 'not_found' }, 404)
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

const done = (extra: Record<string, unknown>) => ({
  task_id: TASK,
  project_id: PROJECT,
  question: QUESTION,
  state: 'SUCCEEDED',
  ...extra,
})

describe('让 AI 找', () => {
  it('免费匹配自动钉版并交回选择与收据，等待用户提交才分析', async () => {
    result = done({
      contract: 'knowbench/expert-match/v2',
      outcome: 'summon',
      picks: [pick(true)],
      match_task_id: TASK,
      match_artifact_version: 2,
      question_revision: 1,
    })
    page(<FindExpertPanel task={TASK} project={PROJECT} onSelect={selected} />)
    await waitFor(() => expect(selected).toHaveBeenCalledTimes(1))
    expect(selected).toHaveBeenCalledWith(
      expect.objectContaining({
        pack: expect.objectContaining({ id: PACK.id }),
        question: QUESTION,
        match: {
          match_task_id: TASK,
          match_artifact_version: 2,
          question_revision: 1,
          knowbot_id: KNOWBOT,
          version: '2',
        },
      }),
    )
    expect(calls.map((c) => c.path)).toEqual(['/api/workbench/knowbots/pin'])
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('已选中')
  })
  it('改了问题不沿用原查找结果', async () => {
    result = done({ outcome: 'summon', picks: [pick(true)] })
    page(
      <FindExpertPanel
        task={TASK}
        project={PROJECT}
        onSelect={selected}
        expectedQuestion="另一个问题"
      />,
    )
    expect(await screen.findByText(messages.findExpert.questionChanged)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    expect(selected).not.toHaveBeenCalled()
  })
  it('离开旧查找结果后，迟到的钉版响应不重新选中专家', async () => {
    result = done({ outcome: 'summon', picks: [pick(true)] })
    const original = global.fetch
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const response = await original(input, init)
        if (String(input).endsWith('/pin')) await pending
        return response
      }),
    )
    const view = page(<FindExpertPanel task={TASK} project={PROJECT} onSelect={selected} />)
    await waitFor(() => expect(calls).toHaveLength(1))
    view.unmount()
    await act(async () => {
      release()
      await pending
    })
    expect(selected).not.toHaveBeenCalled()
  })
  it('部分覆盖或待澄清不自动选中，不自动改走通用模型', async () => {
    result = done({ outcome: 'clarify', clarification: '请确定预测时点', picks: [pick(true)] })
    page(<FindExpertPanel task={TASK} project={PROJECT} onSelect={selected} />)
    expect(await screen.findByText('请确定预测时点')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    expect(selected).not.toHaveBeenCalled()
  })
  it('缺少新契约收据时不钉版或选中', async () => {
    result = done({ contract: 'knowbench/expert-match/v2', outcome: 'summon', picks: [pick(true)] })
    page(<FindExpertPanel task={TASK} project={PROJECT} onSelect={selected} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.findExpert.summonFailed)
    expect(calls).toHaveLength(0)
    expect(selected).not.toHaveBeenCalled()
  })
  it.each(['candidates', 'summon'])('收费候选即使结果为%s也不自动选中', async (outcome) => {
    result = done({ outcome, picks: [pick(false)] })
    page(<FindExpertPanel task={TASK} project={PROJECT} onSelect={selected} />)
    expect(await screen.findByText('¥5.00（这一版付一次）')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '选择这位' }))
    await waitFor(() => expect(selected).toHaveBeenCalledTimes(1))
    expect(calls.map((c) => c.path)).toEqual(['/api/workbench/knowbots/pin'])
    expect(push).not.toHaveBeenCalled()
  })
  it('钉版丢响应可重试同一版本，不创建分析委托', async () => {
    result = done({ outcome: 'summon', picks: [pick(true)] })
    const original = global.fetch
    let lost = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const response = await original(input, init)
        if (String(input).endsWith('/pin') && lost) {
          lost = false
          throw new TypeError('lost')
        }
        return response
      }),
    )
    page(<FindExpertPanel task={TASK} project={PROJECT} onSelect={selected} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.findExpert.summonFailed)
    expect(selected).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重试选中' }))
    await waitFor(() => expect(selected).toHaveBeenCalledTimes(1))
    expect(calls).toHaveLength(2)
    expect(calls[1].body).toEqual(calls[0].body)
    expect(calls.every((c) => c.path.endsWith('/pin'))).toBe(true)
  })

  it('都不合适：标出推荐，两件事都不自动做；直接答开一段记来源的聊天', async () => {
    result = done({
      outcome: 'none',
      picks: [],
      recommend: { action: 'direct', reason: '一次性的问题，直接答就够' },
      demand: { title: '毛利率变化', problem: QUESTION },
    })
    page(<FindExpertPanel task={TASK} project={PROJECT} onSelect={selected} />)
    expect(await screen.findByTestId('find-recommend')).toHaveTextContent(
      '推荐：让我的模型直接答。一次性的问题，直接答就够',
    )
    expect(calls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '让我的模型直接答' }))
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(calls[0]).toMatchObject({
      path: '/api/workbench/sessions',
      body: { kind: 'chat', project_id: PROJECT, origin: 'direct_answer' },
    })
    expect(calls[1]).toMatchObject({
      path: `/api/workbench/sessions/${TALK}/turns`,
      body: { text: QUESTION },
    })
    expect(push).toHaveBeenCalledWith(`/zh-CN/workbench/projects/${PROJECT}/c/${TALK}`)
  })

  it('孵化建申请、提示去 knowlab 看；需求可改，点「发布」才挂', async () => {
    result = done({
      outcome: 'none',
      picks: [],
      recommend: { action: 'incubate', reason: '常会问到' },
      demand: { title: '毛利率变化', problem: QUESTION },
    })
    page(<FindExpertPanel task={TASK} project={PROJECT} onSelect={selected} />)
    fireEvent.click(await screen.findByRole('button', { name: '孵化一个专家' }))
    expect(
      await screen.findByText('已在 knowlab 建了申请「毛利率变化」，到 knowlab「申请」里看。'),
    ).toBeInTheDocument()
    expect(calls[0]).toMatchObject({
      path: `/api/workbench/find-expert/${TASK}/incubation`,
      body: {},
    })

    fireEvent.change(screen.getByLabelText('需求名称'), { target: { value: '毛利率拆解' } })
    fireEvent.click(screen.getByRole('button', { name: '发布' }))
    expect(await screen.findByText('已在 knowmart 挂出。')).toBeInTheDocument()
    expect(calls[1]).toMatchObject({
      path: `/api/workbench/find-expert/${TASK}/demand`,
      body: { title: '毛利率拆解', problem: QUESTION },
    })
  })

  it('没有合适专家时可就此结束，保留记录且不发起聊天、委托或孵化', async () => {
    result = done({ outcome: 'none', picks: [] })
    page(<FindExpertPanel task={TASK} project={PROJECT} onSelect={selected} />)
    fireEvent.click(await screen.findByRole('button', { name: '就此结束' }))
    expect(push).toHaveBeenCalledWith(`/zh-CN/workbench/projects/${PROJECT}`)
    expect(calls).toHaveLength(0)
    expect(screen.getByText(messages.findExpert.finishHereNote)).toBeInTheDocument()
  })
})

describe('直接答的那段对话', () => {
  it('顶上照实说不是专家答的；记得哪一轮来的就能孵化，附上这段对话', async () => {
    window.localStorage.setItem(`workbench.directAnswer.${TALK}`, JSON.stringify({ task: TASK }))
    page(<DirectAnswerNote conversation={TALK} />)
    expect(screen.getByRole('note')).toHaveTextContent('这是你的模型直接答的，不是专家')
    fireEvent.click(screen.getByRole('button', { name: '孵化一个专家（附这份回答）' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      path: `/api/workbench/find-expert/${TASK}/incubation`,
      body: { conversation_id: TALK },
    })
  })

  it('换了浏览器、不知道是哪一轮：只说明，不给孵化按钮', () => {
    page(<DirectAnswerNote conversation={TALK} />)
    expect(screen.getByRole('note')).toHaveTextContent('不是专家')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
