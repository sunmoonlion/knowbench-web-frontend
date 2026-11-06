// 请清单 v2 的专家（SDD 0043，decisions ⑭）：请专家页上不用选数据，请求里不带数据；
// 要什么数据开跑后由第 0 步按问题提出、在委托页确认
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AskExpertScreen } from '@/features/expert'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const push = vi.fn()
let search = ''
let match: Record<string, unknown> | null = null
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

// 清单 v2 的分身与内置专家各一位（只要页面用到的字段）；专家清单不取样例，样例里有谁随生成器变
const KNOWBOT = 'knowbot:11111111-2222-4333-8444-555555555555@1'
const pack = (id: string, name: string) => ({
  id,
  name,
  tagline: '看三张表',
  solves: '看清这家公司这几年的经营',
  does_not_solve: '买卖建议',
  input: '一个问题',
  output: '成稿',
  uses_our_data: false,
  status: 'ready',
  source: id.startsWith('knowbot:') ? 'knowbot' : 'builtin',
  steps: [
    { index: 1, title: '定范围', summary: '按问题定范围', after_rejection: { text: '交你看' } },
  ],
})
const PACKS = {
  contract_version: 'v2',
  budget: { currency: 'CNY', default: null },
  packs: [pack(KNOWBOT, '财务分析与预测'), pack('BUILTIN', '内置的一位')],
}
const NEEDS: Record<string, unknown> = {
  [KNOWBOT]: { contract_version: 'v2', contract: 'knowbot-manifest/v2', bound: 2 },
  BUILTIN: { contract_version: 'v2', contract: null, bound: 0 },
}

type Call = { method: string; path: string; body: Record<string, unknown> }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  search = ''
  match = null
  push.mockReset()
  window.sessionStorage.clear()
  window.sessionStorage.setItem('workbench.question', '看看这家公司这几年的年报')
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
      if (path === '/api/workbench/packs') return json(PACKS)
      if (path.startsWith('/api/workbench/find-expert/')) {
        return json(
          match ?? {
            task_id: '11111111-1111-4111-8111-111111111111',
            project_id: project,
            question: '看看这家公司这几年的年报',
            state: 'RUNNING',
          },
        )
      }
      const needs = /^\/api\/workbench\/packs\/(.+)\/data-needs$/.exec(path)
      if (needs) return json(NEEDS[decodeURIComponent(needs[1])])
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
  it('澄清后保留问题与指定专家，由用户另点查找才重新匹配', async () => {
    const task = '11111111-1111-4111-8111-111111111111'
    search = `match=${task}`
    match = {
      task_id: task,
      project_id: project,
      question: '看看这家公司这几年的年报',
      state: 'SUCCEEDED',
      outcome: 'clarify',
      clarification: '需要哪家公司？',
      picks: [],
    }
    page(<AskExpertScreen project={project} from={null} expert={KNOWBOT} />)
    const input = await screen.findByRole('textbox', { name: '补充后的完整问题' })
    const revised = '看看贵州茅台2021至2024年的年报'
    fireEvent.change(input, { target: { value: revised } })
    fireEvent.click(screen.getByRole('button', { name: '带回提问框' }))
    expect(screen.getByLabelText('要解决什么问题')).toHaveValue(revised)
    expect(window.sessionStorage.getItem('workbench.question')).toBe(revised)
    const editUrl = new URL(push.mock.calls.at(-1)![0], 'https://example.test')
    expect(editUrl.searchParams.has('match')).toBe(false)
    expect(editUrl.searchParams.get('expert')).toBe(KNOWBOT)
    expect(calls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'ai去knowmart请回专家' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].path).toBe(`/api/workbench/projects/${project}/find-expert`)
    expect(calls[0].body.question).toBe(revised)
    expect(calls[0].body).not.toHaveProperty('match')
    expect(calls[0].body).not.toHaveProperty('plan')
  })

  it('未填问题也能从并列入口到 knowlab 提交创意，不创建申请或收费任务', async () => {
    window.sessionStorage.removeItem('workbench.question')
    page(<AskExpertScreen project={project} from={null} expert={null} />)
    const link = await screen.findByRole('link', { name: '去knowlab提交创意' })
    expect(link).toHaveAttribute(
      'href',
      'https://knowlab.example.test/zh-CN/applications/new?from=knowbench&ref=expert',
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: '自己去knowmart请专家' }).parentElement).toBe(
      link.parentElement,
    )
    expect(screen.getByRole('button', { name: 'ai去knowmart请回专家' }).parentElement).toBe(
      link.parentElement,
    )
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
    page(<AskExpertScreen project={project} from={null} expert={KNOWBOT} />)
    await screen.findByText(messages.askExpert.queueHint)
    fireEvent.click(screen.getByRole('button', { name: 'ai去knowmart请回专家' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].path).toBe(`/api/workbench/projects/${project}/find-expert`)
  })

  it('问题为空时AI入口可点，聚焦问题而不发起付费查找；填写后再次点击才查找', async () => {
    window.sessionStorage.clear()
    page(<AskExpertScreen project={project} from={null} expert={null} />)
    await screen.findByText('先写清楚要解决什么问题。')
    const find = screen.getByRole('button', { name: 'ai去knowmart请回专家' })
    expect(find).toBeEnabled()
    fireEvent.click(find)
    const input = screen.getByRole('textbox', { name: '要解决什么问题' })
    expect(input).toHaveFocus()
    expect(calls).toHaveLength(0)
    fireEvent.change(input, { target: { value: '分析贵州茅台营收' } })
    expect(calls).toHaveLength(0)
    fireEvent.click(find)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].path).toBe(`/api/workbench/projects/${project}/find-expert`)
  })

  it('清单 v2 的专家不用选数据，说明自带几份；交出的请求不带数据', async () => {
    page(<AskExpertScreen project={project} from={null} expert={KNOWBOT} />)
    const data = within(await screen.findByTestId('ask-by-question'))
    expect(data.getByText('专家还自带 2 份资料（作者挑选的）。')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '交给专家' })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toMatchObject({ expert: KNOWBOT, question: '看看这家公司这几年的年报' })
    expect(calls[0].body).not.toHaveProperty('data')
  })

  it('「ai去knowmart请回专家」不用先选专家：带着问题开一轮找专家', async () => {
    page(<AskExpertScreen project={project} from={null} expert={null} />)
    const find = screen.getByRole('button', { name: 'ai去knowmart请回专家' })
    await waitFor(() => expect(find).toBeEnabled())
    fireEvent.click(find)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].path).toBe(`/api/workbench/projects/${project}/find-expert`)
    expect(calls[0].body).toMatchObject({ question: '看看这家公司这几年的年报' })
    expect(calls[0].body.match_contract).toBe('knowbench/expert-match/v4')
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.stringContaining('?match=11111111-1111-4111-8111-111111111111'),
      ),
    )
  })

  it('动态专家仍展示数据确认说明，任务步骤由作者方法按问题选择', async () => {
    const originalNeeds = NEEDS[KNOWBOT]
    const originalSteps = PACKS.packs[0].steps
    NEEDS[KNOWBOT] = { contract_version: 'v2', contract: 'knowbot-manifest/v3', bound: 2 }
    PACKS.packs[0].steps = []
    try {
      page(<AskExpertScreen project={project} from={null} expert={KNOWBOT} />)
      expect(await screen.findByText(messages.askExpert.dynamicPlan)).toBeInTheDocument()
      expect(screen.getByTestId('ask-by-question')).toHaveTextContent('作者挑选的')
      expect(screen.queryByText('定范围')).not.toBeInTheDocument()
      const submit = screen.getByRole('button', { name: '交给专家' })
      await waitFor(() => expect(submit).toBeEnabled())
      fireEvent.click(submit)
      await waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0].body).not.toHaveProperty('data')
      expect(calls[0].body).not.toHaveProperty('plan')
    } finally {
      NEEDS[KNOWBOT] = originalNeeds
      PACKS.packs[0].steps = originalSteps
    }
  })

  it('内置专家不用数据：没有数据那一节', async () => {
    page(<AskExpertScreen project={project} from={null} expert="BUILTIN" />)
    expect(await screen.findByRole('heading', { name: /内置的一位/ })).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '交给专家' })
    await waitFor(() => expect(submit).toBeEnabled())
    expect(screen.queryByTestId('ask-by-question')).toBeNull()
  })
})
