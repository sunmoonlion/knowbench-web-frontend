import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MachinesRedirect, MachinesScreen } from '@/features/settings'
import {
  formatPairingCode,
  minutesRemaining,
  pairingCodeComplete,
} from '@/features/settings/model/onboarding'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/zh-CN/workbench/settings/cloud',
}))

const lookup = {
  id: 'pair-1',
  machine_name: '家里的电脑',
  os: 'windows',
  agent_version: '0.2.4',
  codex_version: '0.155.1',
  source_ip: '203.0.113.8',
  requested_seconds_ago: 12,
  replaces_machine: null as string | null,
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function page(node: React.ReactNode, user?: { name: string; email: string | null }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-fixture" locale="zh-CN" user={user}>
          {node}
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('连接码', () => {
  it('只留字母表里的字符，自动大写并补横线', () => {
    expect(formatPairingCode('ab1-io0')).toBe('AB')
    expect(formatPairingCode('k3np-q7r2')).toBe('K3NP-Q7R2')
    expect(pairingCodeComplete('K3NP-Q7R2')).toBe(true)
    expect(pairingCodeComplete('K3NPQ7R2')).toBe(false)
    expect(
      minutesRemaining('2026-10-10T10:10:00+00:00', Date.parse('2026-10-10T10:03:30+00:00')),
    ).toBe(7)
  })

  it('码不对或已过期只说这一句', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/api/workbench/environments'))
          return json({ contract_version: 2, environments: [] })
        if (String(url).endsWith('/api/workbench/agent/download'))
          return json({ contract_version: 2, download: null })
        if (String(url).endsWith('/api/workbench/sandboxes/provisioned'))
          return json({ status: 'absent' })
        return json({ code: 'agent_pairing_rejected' }, 404)
      }),
    )
    page(<MachinesScreen />)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'k3npq7r2' } })
    fireEvent.click(screen.getByRole('button', { name: '核对这台电脑' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('码不对或已过期')
  })

  it('允许之前写明这台电脑连到哪个账号（账 133）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/lookup')) return json(lookup)
        if (String(url).endsWith('/api/workbench/environments'))
          return json({ contract_version: 2, environments: [] })
        if (String(url).endsWith('/api/workbench/agent/download'))
          return json({ contract_version: 2, download: null })
        return json({ status: 'absent' })
      }),
    )
    page(<MachinesScreen />, { name: '分身测试', email: 'tester@example.com' })
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'K3NPQ7R2' } })
    fireEvent.click(screen.getByRole('button', { name: '核对这台电脑' }))
    const into = await screen.findByText(
      messages.machines.connect.intoAccount.replace('{account}', '分身测试'),
    )
    expect(into.getAttribute('title')).toBe('tester@example.com')
  })

  it('有旧电脑才提示会断开，没有就不说', async () => {
    const withReplace = { ...lookup, replaces_machine: '办公室的电脑' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/lookup')) {
          const body = JSON.parse(String(init?.body)) as { user_code: string }
          return json(body.user_code === 'K3NP-Q7R2' ? withReplace : lookup)
        }
        if (String(url).endsWith('/api/workbench/environments'))
          return json({ contract_version: 2, environments: [] })
        if (String(url).endsWith('/api/workbench/agent/download'))
          return json({ contract_version: 2, download: null })
        return json({ status: 'absent' })
      }),
    )
    page(<MachinesScreen />)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'AAAA2222' } })
    fireEvent.click(screen.getByRole('button', { name: '核对这台电脑' }))
    await screen.findByText('家里的电脑')
    expect(screen.queryByText(/会断开/)).toBeNull()
    fireEvent.change(input, { target: { value: 'K3NPQ7R2' } })
    fireEvent.click(screen.getByRole('button', { name: '核对这台电脑' }))
    expect(await screen.findByText('允许后，办公室的电脑 会断开')).toBeVisible()
  })

  it('复制安装命令后提示剩余时间；点太快单独说明', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    let installs = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/install-command')) {
          installs += 1
          if (installs > 1) return json({ code: 'request_invalid' }, 429)
          return json({
            command: 'irm https://downloads.example/script | iex',
            expires_at: '2026-10-10T10:10:00+00:00',
          })
        }
        if (String(url).endsWith('/api/workbench/agent/download')) {
          return json({
            contract_version: 2,
            download: {
              url: 'https://downloads.example/a.zip',
              version: '0.2.4',
              codex_version: '0.155.1',
              zip_sha256: 'a'.repeat(64),
              manifest_sha256: 'b'.repeat(64),
              size_bytes: 1048576,
            },
          })
        }
        if (init?.method === 'GET' && String(url).endsWith('/api/workbench/environments'))
          return json({ contract_version: 2, environments: [] })
        return json({ status: 'absent' })
      }),
    )
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-10T10:00:00+00:00'))
    page(<MachinesScreen />)
    fireEvent.click(await screen.findByRole('button', { name: '复制安装命令' }))
    expect(await screen.findByText(/还剩 10 分钟/)).toBeVisible()
    expect(writeText).toHaveBeenCalledWith('irm https://downloads.example/script | iex')
    fireEvent.click(screen.getByRole('button', { name: '复制安装命令' }))
    expect(await screen.findByText('点得太快了，稍等再试')).toBeVisible()
  })

  it('旧的我的电脑地址转到设置页的电脑一节', () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { replace })
    page(<MachinesRedirect />)
    expect(screen.getByRole('link', { name: '电脑、link、沙箱与令牌' })).toHaveAttribute(
      'href',
      '/zh-CN/workbench/settings/computer',
    )
  })

  it('来源地址空着时显示未知，不当成码不对', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/lookup')) return json({ ...lookup, source_ip: null })
        if (String(url).endsWith('/api/workbench/environments'))
          return json({ contract_version: 2, environments: [] })
        if (String(url).endsWith('/api/workbench/agent/download'))
          return json({ contract_version: 2, download: null })
        return json({ status: 'absent' })
      }),
    )
    page(<MachinesScreen />)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'K3NPQ7R2' } })
    fireEvent.click(screen.getByRole('button', { name: '核对这台电脑' }))
    expect(await screen.findByText('未知')).toBeVisible()
    expect(screen.queryByText('码不对或已过期')).toBeNull()
  })

  it('页面带电脑锚点', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/api/workbench/environments'))
          return json({ contract_version: 2, environments: [] })
        if (String(url).endsWith('/api/workbench/agent/download'))
          return json({ contract_version: 2, download: null })
        return json({ status: 'absent' })
      }),
    )
    page(<MachinesScreen />)
    await waitFor(() => expect(document.getElementById('computer')).not.toBeNull())
  })
})
