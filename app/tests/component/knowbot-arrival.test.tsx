import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowbotArrival } from '@/components/workbench/knowbot-arrival'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const KNOWBOT = '0b8a6c3e-1f2d-4c5b-9a7e-6d5c4b3a2f10'
const replace = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => search,
}))

const PACK = {
  id: `knowbot:${KNOWBOT}@1`,
  name: '我的方法',
  tagline: '按我的口径看一家公司',
  solves: '',
  does_not_solve: '',
  input: '',
  output: '',
  uses_our_data: false,
  source: 'knowbot',
  steps: [],
}

type Call = { path: string; body: unknown; csrf: string | null }
let calls: Call[] = []

function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stub(pin: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input).split('?')[0]
      if (path === '/api/workbench/knowbots/pin') {
        const headers = new Headers(init.headers)
        calls.push({
          path,
          body: JSON.parse(String(init.body)),
          csrf: headers.get('X-CSRF-Token'),
        })
        return pin()
      }
      return answer(404, { code: 'not_found' })
    }),
  )
}

function page() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-for-test" locale="zh-CN">
          <KnowbotArrival />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

beforeEach(() => {
  calls = []
  replace.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  search = new URLSearchParams()
})

describe('从 knowmart 选定分身回来', () => {
  it('pins it once and switches to the expert mode with it chosen', async () => {
    search = new URLSearchParams({ ref: 'expert', knowbot: `${KNOWBOT}@1` })
    stub(() => answer(200, { contract_version: 2, pack: PACK }))
    page()
    expect(screen.getByRole('status')).toHaveTextContent('正在核对')
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/zh-CN/workbench?mode=expert&expert=${encodeURIComponent(PACK.id)}`,
      ),
    )
    expect(calls).toEqual([
      {
        path: '/api/workbench/knowbots/pin',
        body: { knowbot: `${KNOWBOT}@1` },
        csrf: 'csrf-for-test',
      },
    ])
  })

  it('ignores links without a well-formed knowbot', () => {
    search = new URLSearchParams({ knowbot: 'someone-else@1' })
    stub(() => answer(200, {}))
    const { container } = page()
    expect(container).toBeEmptyDOMElement()
    expect(calls).toEqual([])
  })

  it('says plainly when the knowbot is not yours or knowmart is down', async () => {
    search = new URLSearchParams({ knowbot: `${KNOWBOT}@1` })
    stub(() => answer(404, { code: 'no_such_expert', status: 404, detail: 'no such knowbot' }))
    const { unmount } = page()
    expect(await screen.findByRole('alert')).toHaveTextContent('没找到这位专家')
    unmount()
    stub(() =>
      answer(503, { code: 'knowbot_unavailable', status: 503, detail: 'knowmart is unavailable' }),
    )
    page()
    expect(await screen.findByRole('alert')).toHaveTextContent('knowmart 暂时连不上')
    expect(replace).not.toHaveBeenCalled()
  })
})
