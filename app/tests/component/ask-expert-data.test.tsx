// 请写了数据需求声明的专家（SDD 0042 第五节第 6 项）：按声明选好数据才能交出，选的数据随请求带上
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
  needs: [
    {
      key: 'annual_reports',
      name: '年报',
      description: '最近几年的年度报告全文',
      formats: ['pdf'],
      required: true,
      min_count: 1,
      max_count: 2,
      tables: [],
    },
  ],
  last: [],
}
const CLOUD = {
  contract_version: 'v2',
  items: [
    {
      item_id: 'i1',
      name: '2024 年报.pdf',
      media_type: 'application/pdf',
      size_bytes: 10,
      sha256: 'c'.repeat(64),
      origin: 'upload',
      created_at: '2026-10-23T12:00:00Z',
    },
    {
      item_id: 't1',
      name: '口径说明.txt',
      media_type: 'text/plain; charset=utf-8',
      size_bytes: 3,
      sha256: 'd'.repeat(64),
      origin: 'upload',
      created_at: '2026-10-23T12:00:00Z',
    },
  ],
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
      if (path === '/api/workbench/packs/FIN_REVIEW/data-needs') return json(NEEDS)
      if (path === '/api/workbench/cloud-library') return json(CLOUD)
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

describe('请专家用自己的数据', () => {
  it('必填的没选不能交；在弹框里从云端知识库选了，随请求带上', async () => {
    page(<AskExpertScreen project={project} from={null} expert="FIN_REVIEW" />)
    const data = within(await screen.findByRole('region', { name: '要用的数据' }))
    expect(data.getByText('年报')).toBeInTheDocument()
    expect(data.getByText('必填 · 选 1～2 份 · PDF')).toBeInTheDocument()
    expect(data.getByText('还没选')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '交给专家' })
    await waitFor(() => expect(screen.getByText('专家要的数据还没选好。')).toBeInTheDocument())
    expect(submit).toBeDisabled()

    fireEvent.click(data.getByRole('button', { name: '选数据' }))
    const dialog = within(await screen.findByRole('dialog'))
    // 只列格式对得上的：文本不是年报要的
    const report = await dialog.findByRole('button', { name: /2024 年报\.pdf/ })
    expect(dialog.queryByRole('button', { name: /口径说明/ })).toBeNull()
    fireEvent.click(report)
    expect(dialog.getByText('已选 1 份', { selector: 'span' })).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: '好了' }))

    await waitFor(() => expect(submit).toBeEnabled())
    expect(data.getByText('2024 年报.pdf')).toBeInTheDocument()
    fireEvent.click(submit)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body.data).toEqual([{ need: 'annual_reports', source: 'cloud', item_id: 'i1' }])
  })

  it('同一项目上次选的默认选上', async () => {
    NEEDS.last = [
      { need: 'annual_reports', source: 'cloud', name: '2024 年报.pdf', item_id: 'i1' },
    ] as never
    try {
      page(<AskExpertScreen project={project} from={null} expert="FIN_REVIEW" />)
      const data = within(await screen.findByRole('region', { name: '要用的数据' }))
      expect(await data.findByText('2024 年报.pdf')).toBeInTheDocument()
      expect(data.getByRole('button', { name: '改选' })).toBeInTheDocument()
      const submit = screen.getByRole('button', { name: '交给专家' })
      await waitFor(() => expect(submit).toBeEnabled())
    } finally {
      NEEDS.last = []
    }
  })
})
