import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { SessionBoundary, useRecoveredSession } from '@/components/auth/session-boundary'
import type { BrowserSession } from '@/contracts/auth'
import { sessionFetch, sessionRecovery } from '@/lib/auth/session-recovery'
import messages from '@/messages/zh-CN.json'

const initial: BrowserSession = {
  contract_version: 1,
  authenticated: true,
  csrf_token: 'a'.repeat(32),
  user: {
    actor_id: '00000000-0000-4000-8000-000000000001',
    app: 'tpl',
    surface: 'web',
    roles: [],
    scopes: [],
    expires_at: '2099-01-01T00:00:00Z',
  },
}
afterEach(() => {
  cleanup()
  sessionRecovery.recover()
  vi.unstubAllGlobals()
})

function Editor() {
  const [draft, setDraft] = useState('')
  const recovered = useRecoveredSession()
  useQuery({
    queryKey: ['read'],
    queryFn: () => sessionFetch('/api/web/read', {}),
    refetchInterval: 30,
  })
  const action = useMutation({
    mutationFn: () => sessionFetch('/api/web/action', { method: 'POST' }),
  })
  return (
    <>
      <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <output data-testid="csrf">{recovered?.csrf_token ?? initial.csrf_token}</output>
      <button onClick={() => action.mutate()}>提交</button>
    </>
  )
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  window.history.replaceState({}, '', '/zh-CN/workbench/original?q=keep#step')
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <QueryClientProvider client={client}>
        <SessionBoundary session={initial} locale="zh-CN">
          <Editor />
        </SessionBoundary>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
  return client
}

it('retains input, hides stale identity, stops polling, refreshes CSRF and does not replay actions', async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/auth/web/me')
      return Response.json({ ...initial, csrf_token: 'b'.repeat(32) })
    if (init?.method === 'POST') return new Response('{}', { status: 401 })
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchImpl)
  const client = setup()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '尚未提交的问题' } })
  fireEvent.click(screen.getByText('提交'))
  await screen.findByRole('alertdialog')
  expect(screen.queryByRole('textbox')).toBeNull()
  const count = fetchImpl.mock.calls.length
  await new Promise((r) => setTimeout(r, 90))
  expect(fetchImpl.mock.calls.length).toBe(count)
  expect(screen.getByText('在新标签页登录')).toHaveAttribute(
    'href',
    '/zh-CN/login?next=%2Fzh-CN%2Fworkbench%2Foriginal%3Fq%3Dkeep%23step',
  )
  fireEvent.click(screen.getByText('我已登录，继续原页面'))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.getByRole('textbox')).toHaveValue('尚未提交的问题')
  expect(screen.getByTestId('csrf')).toHaveTextContent('b'.repeat(32))
  expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  client.clear()
})

it('keeps the gate closed when login verification fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 401 })),
  )
  const client = setup()
  await screen.findByRole('alertdialog')
  fireEvent.click(screen.getByText('我已登录，继续原页面'))
  await screen.findByText('还未确认有效登录，请完成登录后再试。')
  expect(sessionRecovery.snapshot()).toBe(true)
  client.clear()
})

it('discards old drafts and cached data when a different account signs in', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/auth/web/me'
        ? Response.json({
            ...initial,
            user: { ...initial.user, actor_id: '00000000-0000-4000-8000-000000000002' },
          })
        : new Response('{}'),
    ),
  )
  const client = setup()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'private draft' } })
  act(() => sessionRecovery.expire())
  fireEvent.click(await screen.findByText('我已登录，继续原页面'))
  await screen.findByText('登录账号已改变')
  expect(screen.queryByDisplayValue('private draft')).toBeNull()
  expect(client.getQueryCache().getAll()).toHaveLength(0)
  expect(sessionRecovery.snapshot()).toBe(true)
})
