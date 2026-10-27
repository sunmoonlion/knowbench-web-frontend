// 请清单 v2 的专家（SDD 0043 第 3.5 节）：填主体、列出清单，必填的都有着落才能交出；
// 缺的随请求一并确认，选择随请求带上（data_v2）
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

const NEEDS = {
  contract_version: 'v2',
  contract: 'knowbot-manifest/v2',
  needs: [
    {
      key: 'annual',
      name: '年报',
      doc_type: 'annual_report',
      period: { kind: 'latest', count: 2 },
      formats: ['pdf'],
      required: true,
      description: '',
    },
  ],
  bound: 1,
  last: [],
}
const candidate = (year: string) => ({
  material_id: `m-${year}`,
  version_no: 1,
  basis: 'public',
  sha256: 'a'.repeat(64),
  name: `贵州茅台${year}年年度报告.pdf`,
  disclosed_on: null,
})
const key = (year: string) => ({
  subject: '600519.SH',
  doc_type: 'annual_report',
  period_start: `${year}-01-01`,
  period_end: `${year}-12-31`,
})
const PLAN = {
  contract_version: 'v2',
  resolution: {
    resolution_id: 'res-1',
    revision: 1,
    items: [
      {
        ref: 'annual:aaa',
        need_key: 'annual',
        key: key('2025'),
        status: 'ambiguous',
        chosen: [],
        candidates: [candidate('2025'), { ...candidate('2025'), material_id: 'm-2025b' }],
        reason: null,
      },
      {
        ref: 'annual:bbb',
        need_key: 'annual',
        key: key('2024'),
        status: 'to_confirm',
        chosen: [],
        candidates: [],
        reason: null,
      },
    ],
  },
  supply_enabled: true,
  bound: 1,
  to_confirm: 1,
  problems: [],
  incomplete: [],
}

type Call = { method: string; path: string; body: Record<string, unknown> }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  push.mockReset()
  window.sessionStorage.clear()
  window.sessionStorage.setItem('workbench.question', '分析茅台')
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
        if (path.endsWith('/data-plan')) return json(PLAN)
        return json({ task_id: '11111111-1111-4111-8111-111111111111' }, 201)
      }
      if (path === '/api/workbench/packs/FIN_REVIEW/data-needs') return json(NEEDS)
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

describe('请清单 v2 的专家', () => {
  it('填主体列出清单；有歧义的选了、缺的随请求确认，才能交出', async () => {
    page(<AskExpertScreen project={project} from={null} expert="FIN_REVIEW" />)
    const data = within(await screen.findByRole('region', { name: '要用的数据' }))
    expect(data.getByText(/专家还自带 1 份资料/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '交给专家' })
    await waitFor(() => expect(screen.getByText('专家要的数据还没选好。')).toBeInTheDocument())
    expect(submit).toBeDisabled()

    const subjects = data.getByRole('textbox', { name: '要分析的公司' })
    fireEvent.change(subjects, { target: { value: '600519.sh, 茅台' } })
    expect(data.getByText(/认不出：茅台/)).toBeInTheDocument()
    expect(data.getByRole('button', { name: '列出数据' })).toBeDisabled()
    fireEvent.change(subjects, { target: { value: '600519.sh' } })
    fireEvent.click(data.getByRole('button', { name: '列出数据' }))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/data-plan'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/data-plan'))!.body).toEqual({
      subjects: ['600519.SH'],
    })
    expect(await data.findByText('有几份，要选一份')).toBeInTheDocument()
    expect(data.getByText('缺，要去取')).toBeInTheDocument()
    expect(data.getByTestId('listed-fetch')).toHaveTextContent('缺的 1 项')
    // 有歧义的没选：还不能交
    expect(submit).toBeDisabled()
    fireEvent.change(data.getByRole('combobox', { name: '年报用哪一份' }), {
      target: { value: 'm-2025b@1' },
    })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/delegations'))).toBe(true))
    const sent = calls.find((c) => c.path.endsWith('/delegations'))!.body
    expect(sent.data_v2).toEqual({
      resolution_id: 'res-1',
      revision: 1,
      picks: { 'annual:aaa': { material_id: 'm-2025b', version_no: 1 } },
      dropped: [],
    })
    expect(sent.data).toBeUndefined()
  })
})
