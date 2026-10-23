// 云端知识库（SDD 0042）：清单、上传、下载、删除、各种拒绝。清单样例是真后端录下来的。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LibraryScreen } from '@/features/library'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const full = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as {
  responses: { method: string; path: string; query: string; file: string }[]
}
const listing = JSON.parse(
  readFileSync(
    join(
      full,
      manifest.responses.find((each) => each.path === '/api/workbench/cloud-library')!.file,
    ),
    'utf8',
  ),
) as { items: { item_id: string; name: string }[] }

type Call = {
  method: string
  path: string
  body: unknown
  csrf: string | null
  type: string | null
}
let calls: Call[] = []
let answers: Record<string, () => Response> = {}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  calls = []
  answers = {
    'GET /api/workbench/cloud-library': () => json(200, listing),
    'POST /api/workbench/cloud-library': () => json(201, { item: listing.items[0] }),
    'DELETE /api/workbench/cloud-library/x': () => new Response(null, { status: 204 }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const [path] = String(input).split('?')
      const method = init.method ?? 'GET'
      const headers = (init.headers ?? {}) as Record<string, string>
      calls.push({
        method,
        path: String(input),
        body: init.body,
        csrf: headers['X-CSRF-Token'] ?? null,
        type: headers['Content-Type'] ?? null,
      })
      const key = `${method} ${path.replace(/cloud-library\/[^/]+$/, 'cloud-library/x')}`
      return (answers[key] ?? (() => json(404, { code: 'not_found' })))()
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-for-test" locale="zh-CN">
          <LibraryScreen />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('云端知识库', () => {
  it('清单：每份写明从哪来（上传、买来），能下载、能删', async () => {
    mount()
    const first = listing.items[0]
    expect(await screen.findByText(first.name)).toBeInTheDocument()
    const list = within(screen.getByRole('list', { name: '云端知识库' }))
    expect(list.getByText('上传')).toBeInTheDocument()
    expect(list.getByText('买来')).toBeInTheDocument()
    const download = screen.getByRole('link', { name: `下载「${first.name}」` })
    expect(download).toHaveAttribute(
      'href',
      `/api/workbench/cloud-library/${first.item_id}/content`,
    )
    expect(screen.getByRole('button', { name: `删掉「${first.name}」` })).toBeInTheDocument()
  })

  it('上传：请求体就是文件本身，带名字与 CSRF', async () => {
    mount()
    await screen.findByText(listing.items[0].name)
    const file = new File(['a,b\n'], '营收.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('选一份文件上传'), { target: { files: [file] } })
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')).toBeTruthy())
    const sent = calls.find((call) => call.method === 'POST')!
    expect(sent.path).toBe(`/api/workbench/cloud-library?name=${encodeURIComponent('营收.csv')}`)
    expect(sent.body).toBe(file)
    expect(sent.csrf).toBe('csrf-for-test')
    expect(sent.type).toBe('text/csv')
    expect(await screen.findByText('已上传「营收.csv」。')).toBeInTheDocument()
  })

  it('超过 50 MB 的不发', async () => {
    mount()
    await screen.findByText(listing.items[0].name)
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 50 * 1024 * 1024 + 1 })
    fireEvent.change(screen.getByLabelText('选一份文件上传'), { target: { files: [big] } })
    expect(await screen.findByText('单份不能超过 50 MB。')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('删：问一句再删；正被用着的照实说', async () => {
    answers['DELETE /api/workbench/cloud-library/x'] = () => json(409, { code: 'in_use' })
    mount()
    const first = listing.items[0]
    fireEvent.click(await screen.findByRole('button', { name: `删掉「${first.name}」` }))
    expect(window.confirm).toHaveBeenCalledWith(`删掉「${first.name}」？删了就没有了。`)
    expect(
      await screen.findByText('这份资料正被用着（请专家或对话里选用了），用完再删。'),
    ).toBeInTheDocument()
    expect(calls.find((call) => call.method === 'DELETE')).toMatchObject({
      path: `/api/workbench/cloud-library/${first.item_id}`,
      csrf: 'csrf-for-test',
    })
  })

  it('登录过期：叫重新登录，上传按钮不能点', async () => {
    answers['GET /api/workbench/cloud-library'] = () => json(401, { code: 'reauth_required' })
    mount()
    expect(
      await screen.findByText('登录过期了，重新登录一下才能用云端知识库。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新登录' })).toHaveAttribute(
      'href',
      `/api/auth/web/login?return_to=${encodeURIComponent('/zh-CN/workbench/library')}`,
    )
    expect(screen.getByRole('button', { name: '上传' })).toBeDisabled()
  })

  it('空的：告诉怎么放进来', async () => {
    answers['GET /api/workbench/cloud-library'] = () => json(200, { items: [] })
    mount()
    expect(await screen.findByText('还没有资料。')).toBeInTheDocument()
  })
})
