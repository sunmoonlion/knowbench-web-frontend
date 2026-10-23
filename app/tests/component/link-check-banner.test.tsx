import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LinkCheckBanner } from '@/features/shell/ui/link-check-banner'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const LOCAL = 'http://127.0.0.1:47811'
const A = '0f8fad5b-d9cb-469f-a165-70867728950e'
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const machine = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'zymun',
  status: 'online',
  roots: [],
  device_id: A,
  host: 'DESKTOP-A',
  first_host: 'DESKTOP-A',
}
let answers: Record<string, unknown> = {}

beforeEach(() => {
  answers = {
    [`${LOCAL}/presence`]: {
      agent: 'sunmoon-agent',
      version: '0.5.2',
      machine_name: 'zymun',
      connected: true,
      device_id: A,
      link_state: 'connected',
    },
    'http://testserver/api/workbench/local-link': {
      assigned: machine,
      copied: false,
      token_expires_at: '2026-11-22T00:00:00+00:00',
    },
    'http://testserver/api/workbench/sandboxes/provisioned': { status: 'ready', ready: true },
    'http://testserver/api/workbench/credentials': {
      credentials: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          provider: 'kimi',
          hint: 'abcd',
          status: 'active',
        },
      ],
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(String(input), 'http://testserver')
      const body = answers[url.origin + url.pathname]
      if (body === undefined) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function banner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf" locale="zh-CN">
          <LinkCheckBanner />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('工作台顶上的核对提示（会合点备忘第五节，账 143）', () => {
  it('甲 = 乙、本地 link 连着、沙箱就绪：什么都不显示', async () => {
    const { container } = banner()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(container).toBeEmptyDOMElement()
  })
  it('甲 ≠ 乙：工作台现在用的不是这台电脑，带去重新颁发令牌', async () => {
    answers[`${LOCAL}/presence`] = { ...(answers[`${LOCAL}/presence`] as object), device_id: B }
    banner()
    expect(await screen.findByText('工作台现在用的不是这台电脑。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新颁发令牌' })).toHaveAttribute(
      'href',
      '/zh-CN/workbench/settings/computer#link-status',
    )
  })
  it('令牌失效与连不上分开说；没登记 key 时另起一行叫先去「模型」', async () => {
    answers[`${LOCAL}/presence`] = {
      ...(answers[`${LOCAL}/presence`] as object),
      connected: false,
      link_state: 'unreachable',
    }
    answers['http://testserver/api/workbench/credentials'] = { credentials: [] }
    banner()
    expect(
      await screen.findByText('本地 link 连不上：检查网络，或退出 link 再重新打开。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '重新颁发令牌' })).toBeNull()
    expect(await screen.findByText('先到「模型」登记模型 key，沙箱才能拉起。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去「模型」' })).toHaveAttribute(
      'href',
      '/zh-CN/workbench/settings/cloud',
    )
  })
})
