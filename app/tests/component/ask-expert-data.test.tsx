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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
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
        return json({ task_id: '11111111-1111-4111-8111-111111111111' }, 201)
      }
      if (path === '/api/workbench/packs') return json(PACKS)
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

  it('内置专家不用数据：没有数据那一节', async () => {
    page(<AskExpertScreen project={project} from={null} expert="BUILTIN" />)
    expect(await screen.findByRole('heading', { name: /内置的一位/ })).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '交给专家' })
    await waitFor(() => expect(submit).toBeEnabled())
    expect(screen.queryByTestId('ask-by-question')).toBeNull()
  })
})
