import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Machine } from '@/contracts/workbench-v2'
import { MachinesScreen } from '@/features/settings'
import { progress } from '@/features/settings/model/guide'
import { SettingsScreen } from '@/features/settings'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/zh-CN/workbench',
}))

const fixtures = join(process.cwd(), 'preview/fixtures')
let scenario = 'full'
function manifestOf(name: string) {
  return JSON.parse(readFileSync(join(fixtures, name, 'manifest.json'), 'utf8')) as {
    pages: { title: string; path: string }[]
    responses: { method: string; path: string; query: string; file: string }[]
  }
}
function sample(path: string): unknown {
  const found = manifestOf(scenario).responses.find(
    (each) => each.method === 'GET' && each.path === path,
  )
  return found ? JSON.parse(readFileSync(join(fixtures, scenario, found.file), 'utf8')) : null
}
type Call = { method: string; path: string; body: Record<string, unknown> }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  scenario = 'full'
  push.mockReset()
  window.sessionStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input).split('?')[0]
      const method = init.method ?? 'GET'
      if (method !== 'GET') {
        calls.push({ method, path, body: JSON.parse(String(init.body ?? '{}')) })
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const body = sample(path)
      return new Response(JSON.stringify(body ?? { code: 'not_found' }), {
        status: body ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      })
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

describe('我的电脑', () => {
  it('三步：有在线电脑即完成；离线只算已安装和已选文件夹', () => {
    const machine = (roots: string[], status: Machine['status'] = 'online') =>
      ({ id: 'x', name: 'm', status, roots }) as Machine
    expect(progress([])).toEqual({ install: false, connect: false, folders: false })
    expect(progress(undefined)).toEqual({ install: false, connect: false, folders: false })
    expect(progress([machine([])])).toEqual({ install: true, connect: true, folders: true })
    expect(progress([machine(['/r'], 'offline')])).toEqual({
      install: true,
      connect: false,
      folders: true,
    })
    expect(progress([machine([], 'offline'), machine([])]).connect).toBe(true)
  })

  it('接入的机器：在线、版本、白名单里的目录、它自己定的上限', async () => {
    page(<MachinesScreen />)
    expect(await screen.findByRole('heading', { name: '办公室的电脑' })).toBeInTheDocument()
    expect(screen.getAllByText('本地 link 连着').length).toBeGreaterThan(0)
    expect(screen.getByText('/home/demo/research')).toBeInTheDocument()
    expect(screen.getByText(/只能改白名单目录里的文件；不许联网/)).toBeInTheDocument()
    expect(screen.getByText(/这些只能在那台机器上改/)).toBeInTheDocument()
    // 已在线可证明持有可用令牌；下载与安装仍由本人确认。
    await waitFor(() => expect(screen.getAllByLabelText('已完成')).toHaveLength(3))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('机器离线：写明本地代理没在运行', async () => {
    scenario = 'offline'
    page(<MachinesScreen />)
    expect(
      await screen.findByText(/本地 link 当前没连着。请在这台电脑的托盘「查看状态与原因」里看原因/),
    ).toBeVisible()
  })

  it('机器离线：能移除这台电脑（账 179），连着的没有这个按钮', async () => {
    scenario = 'offline'
    page(<MachinesScreen />)
    const button = await screen.findByRole('button', { name: '移除这台电脑' })
    button.click()
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'DELETE' && /\/api\/workbench\/environments\/[^/]+$/.test(c.path),
        ),
      ).toBe(true),
    )
  })

  it('机器在线：没有「移除这台电脑」', async () => {
    page(<MachinesScreen />)
    await screen.findByText('本地 link 连着')
    expect(screen.queryByRole('button', { name: '移除这台电脑' })).toBeNull()
  })

  it('还没有电脑：照五步做', async () => {
    scenario = 'empty'
    page(<MachinesScreen />)
    expect(await screen.findAllByText('还没有电脑接入。')).not.toHaveLength(0)
    expect(document.getElementById('computer-status')).toHaveTextContent('还没有电脑接入。')
    expect(screen.getAllByLabelText('还没做')).toHaveLength(3)
  })
})

describe('设置', () => {
  it('模型：模型 key、新对话的默认（MCP 连接 10-18 撤了；沙箱 10-23 挪到「电脑与沙箱」）。给用户看的字里没有「会话」', async () => {
    page(<SettingsScreen section="cloud" />)
    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument()
    for (const name of ['模型 key', '新对话的默认']) {
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('heading', { name: '云端沙箱' })).toBeNull()
    expect(document.body.textContent).not.toContain('会话')
    // 左列三项（0021；会合点备忘第七节 10-23）
    expect(
      screen
        .getAllByRole('link', { name: /^(个人偏好|模型|电脑与沙箱)/ })
        .map((a) => a.getAttribute('href')),
    ).toEqual([
      '/zh-CN/workbench/settings/preferences',
      '/zh-CN/workbench/settings/cloud',
      '/zh-CN/workbench/settings/computer',
    ])
    expect(document.getElementById('computer')).toBeNull()
  })

  it('电脑与沙箱：接入电脑、现在的状态、云端沙箱、这台电脑上的设置都在第三项', async () => {
    page(<SettingsScreen section="computer" />)
    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument()
    await waitFor(() => expect(document.getElementById('computer')).not.toBeNull())
    expect(await screen.findByRole('heading', { name: '这台电脑上的设置' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '云端沙箱' })).toBeInTheDocument()
    expect(document.getElementById('link-status')).not.toBeNull()
    // 页面里不出现「会合点」（会合点备忘第四节）
    expect(document.body.textContent).not.toContain('会合点')
  })
})
