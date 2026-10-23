import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentSetup, ReconnectComputer } from '@/features/settings/ui/agent-setup'
import { AgentDownloadPanel, AgentZipFallback } from '@/features/settings/ui/agent-download'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const token = 'fixture-only-agent-token-not-a-credential'
const revision = 'a'.repeat(64)
const metadata = {
  identity_revision: revision,
  agent_token_expires_at: '2026-11-08T00:00:00+00:00',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function page(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    client,
    ...render(
      <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
        <QueryClientProvider client={client}>
          <WorkbenchProvider csrfToken="csrf-fixture" locale="zh-CN">
            {children}
          </WorkbenchProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    ),
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('agent onboarding', () => {
  it('unconfigured download has no invented URL or automatic mutation', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ contract_version: 2, download: null }))
    vi.stubGlobal('fetch', fetch)
    page(<AgentDownloadPanel csrfToken="csrf-fixture" />)
    expect(await screen.findByText('下载暂未开放')).toBeVisible()
    expect(screen.queryByRole('link', { name: '下载 Windows ZIP' })).toBeNull()
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })
  it('uses configured immutable URL and both hashes for installation', async () => {
    const release = {
      url: 'https://download.example/fixed/windows-x64.zip',
      version: '0.2.0',
      codex_version: '0.155.1',
      zip_sha256: 'c'.repeat(64),
      manifest_sha256: 'd'.repeat(64),
      size_bytes: 174242372,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ contract_version: 2, download: release })),
    )
    page(
      <>
        <AgentDownloadPanel csrfToken="csrf-fixture" />
        <AgentZipFallback />
      </>,
    )
    expect(await screen.findByRole('link', { name: '下载 Windows ZIP' })).toHaveAttribute(
      'href',
      release.url,
    )
    expect(screen.getByText(/166.17 MiB/)).toBeVisible()
    expect(screen.getByText(release.zip_sha256)).toBeVisible()
    expect(screen.getByText(release.manifest_sha256)).toBeVisible()
    expect(screen.getByText(/解除锁定/)).toBeVisible()
  })
  it('first issue keeps token out of commands and query/mutation caches; refresh never issues', async () => {
    const calls: { url: string; method: string }[] = []
    let provisioned = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? 'GET' })
        if (init.method === 'POST') {
          provisioned = true
          expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-fixture')
          return json({
            status: 'starting',
            relay: {
              url: 'wss://relay.example',
              user: 'u-fixture',
              agent_token: token,
              ...metadata,
            },
          })
        }
        return json(
          provisioned
            ? { status: 'ready', relay_user: 'u-fixture', ...metadata }
            : { status: 'absent' },
        )
      }),
    )
    const p = page(<AgentSetup csrfToken="csrf-fixture" />)
    const start = screen.getByRole('button', { name: '拉起沙箱' })
    await waitFor(() => expect(start).toBeEnabled())
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    fireEvent.click(start)
    const secret = await screen.findByLabelText('本人的本地 link 令牌')
    expect(secret).toHaveAttribute('type', 'password')
    expect(secret).toHaveValue(token)
    expect(document.querySelector('[data-issued-command]')!.textContent).toContain('--token-prompt')
    expect(document.querySelector('[data-issued-command]')!.textContent).not.toContain(token)
    await p.client.invalidateQueries({ queryKey: ['wb-provisioned'] })
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
    expect(
      JSON.stringify(
        p.client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(token)
    expect(
      JSON.stringify(
        p.client
          .getMutationCache()
          .getAll()
          .map((m) => m.state.data),
      ),
    ).not.toContain(token)
    expect(window.localStorage.getItem('agent_token')).toBeNull()
    expect(window.sessionStorage.getItem('agent_token')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '清除页面上的令牌' }))
    expect(screen.queryByLabelText('本人的本地 link 令牌')).toBeNull()
  })
  it('rotation confirmation stays bound to the revision shown when opened; no automatic retry', async () => {
    let current = revision
    const mutations: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === 'POST') {
          mutations.push(JSON.parse(String(init.body)))
          return json({ code: 'relay_identity_changed', status: 409 }, 409)
        }
        return json({
          status: 'ready',
          relay_user: 'u-fixture',
          ...metadata,
          identity_revision: current,
        })
      }),
    )
    const p = page(<ReconnectComputer csrfToken="csrf-fixture" />)
    fireEvent.click(await screen.findByRole('button', { name: '重新颁发令牌' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('会同时换掉电脑和云端沙箱的令牌')
    current = 'b'.repeat(64)
    await p.client.invalidateQueries({ queryKey: ['wb-provisioned'] })
    fireEvent.click(within(dialog).getByRole('button', { name: '确定更换' }))
    await screen.findByText(/接入状态已变化或操作仍在进行/)
    expect(mutations).toEqual([{ expected_revision: revision }])
    expect(screen.queryByLabelText('本人的本地 link 令牌')).toBeNull()
  })
})
