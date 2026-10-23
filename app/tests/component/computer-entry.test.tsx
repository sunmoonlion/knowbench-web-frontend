import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeScreen } from '@/features/home'
import { AskExpertScreen, ExpertHomeScreen } from '@/features/expert'
import { MachinesScreen } from '@/features/settings'
import { NewProjectDialog } from '@/features/projects/ui/new-project-dialog'
import { Sidebar } from '@/features/shell/ui/sidebar'
import { WorkbenchProvider } from '@/lib/workbench/context'
import { workbenchKeys } from '@/lib/workbench/queries'
import zh from '@/messages/zh-CN.json'
import en from '@/messages/en.json'

const navigation = vi.hoisted(() => ({ query: '', push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.query),
  usePathname: () => '/zh-CN/workbench',
}))
const fixture = (name: string, path: string) => {
  const directory = join(process.cwd(), 'preview/fixtures', name)
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
    responses: { method: string; path: string; file: string }[]
  }
  const entry = manifest.responses.find((r) => r.method === 'GET' && r.path === path)
  return entry ? JSON.parse(readFileSync(join(directory, entry.file), 'utf8')) : null
}
const connected = fixture('full', '/api/workbench/environments').environments
const release = {
  url: 'https://download.example/agent.zip',
  version: '0.2.1',
  codex_version: '0.155.1',
  zip_sha256: 'a'.repeat(64),
  manifest_sha256: 'b'.repeat(64),
  size_bytes: 174243923,
}
let environment: 'empty' | 'full' | 'error' | 'pending'
let hasSandbox: boolean
let issuedIdentity: boolean
const calls: { path: string; method: string }[] = []
const clients: QueryClient[] = []
beforeEach(() => {
  environment = 'empty'
  hasSandbox = true
  issuedIdentity = true
  navigation.query = ''
  navigation.push.mockReset()
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input).split('?')[0]
      calls.push({ path, method: init.method ?? 'GET' })
      if (init.method && init.method !== 'GET') throw new Error('Unexpected mutation')
      if (path === '/api/workbench/environments') {
        if (environment === 'pending') return new Promise<Response>(() => {})
        if (environment === 'error') return Response.json({ code: 'unavailable' }, { status: 503 })
        return Response.json(fixture(environment, path))
      }
      if (path === '/api/web/v1/cross-app/links')
        return Response.json({
          app: 'knowbench',
          targets: { knowmart: { web_base_url: 'https://knowmart.example.test' } },
        })
      if (path === '/api/workbench/agent/download')
        return Response.json({ contract_version: 2, download: release })
      if (path === '/api/workbench/sandboxes/provisioned')
        return Response.json({
          status: 'ready',
          relay_user: issuedIdentity ? 'fixture-user' : null,
          identity_revision: 'a'.repeat(64),
        })
      // 云端沙箱与电脑无关：聊天有沙箱就能发消息。
      const body = fixture(
        path === '/api/workbench/sandboxes' && hasSandbox ? 'full' : 'empty',
        path,
      )
      return Response.json(body ?? { code: 'not_found' }, { status: body ? 200 : 404 })
    }),
  )
})
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
function page(children: React.ReactNode, locale: 'zh-CN' | 'en' = 'zh-CN') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return {
    client,
    ...render(children, {
      wrapper: ({ children }) => (
        <NextIntlClientProvider
          locale={locale}
          messages={locale === 'zh-CN' ? zh : en}
          timeZone="Asia/Shanghai"
        >
          <QueryClientProvider client={client}>
            <WorkbenchProvider csrfToken="csrf-fixture" locale={locale}>
              {children}
            </WorkbenchProvider>
          </QueryClientProvider>
        </NextIntlClientProvider>
      ),
    }),
  }
}
const checkLink = (locale: 'zh-CN' | 'en' = 'zh-CN') => {
  expect(
    screen.getByRole('link', { name: locale === 'zh-CN' ? '接入电脑' : 'Connect computer' }),
  ).toHaveAttribute('href', `/${locale}/workbench/settings/computer`)
}

describe('电脑接入入口', () => {
  it('首次卡片依次引导设置 key 和接电脑，不重复显示下方沙箱提示', async () => {
    hasSandbox = false
    page(<HomeScreen />)
    const card = await screen.findByRole('region', { name: zh.computerConnection.welcome })
    expect(
      within(card)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/zh-CN/workbench/settings/cloud', '/zh-CN/workbench/settings/computer'])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '你好' } })
    expect(screen.queryByText(zh.home.blocker.noSandbox)).toBeNull()
    expect(screen.getByRole('button', { name: zh.home.mode.chat.send })).toBeDisabled()
  })
  it.each(['zh-CN', 'en'] as const)('通用首页展示卡片，登记电脑后消失（%s）', async (locale) => {
    const p = page(<HomeScreen />, locale)
    const title = (locale === 'zh-CN' ? zh : en).computerConnection.welcome
    expect(await screen.findByRole('region', { name: title })).toBeVisible()
    checkLink(locale)
    act(() => p.client.setQueryData(workbenchKeys.machines, connected))
    await waitFor(() => expect(screen.queryByRole('region', { name: title })).toBeNull())
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })
  it.each(['pending', 'error'] as const)('首页列表 %s 不当作没有电脑', async (state) => {
    environment = state
    const { client } = page(<HomeScreen />)
    await waitFor(() => expect(client.getQueryState(workbenchKeys.machines)?.status).toBe(state))
    expect(screen.queryByRole('link', { name: '接入电脑' })).toBeNull()
  })
  it.each(['mode=chat', 'mode=chat&project=fixture-project'])(
    '明确进入聊天，不提示接入、不以缺电脑拦截（%s）',
    async (query) => {
      navigation.query = query
      const { client } = page(<HomeScreen />)
      await waitFor(() =>
        expect(client.getQueryState(workbenchKeys.machines)?.status).toBe('success'),
      )
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '你好' } })
      expect(screen.getByRole('button', { name: zh.home.mode.chat.send })).toBeEnabled()
      expect(screen.queryByRole('link', { name: '接入电脑' })).toBeNull()
      expect(screen.queryByText(zh.home.blocker.noMachine)).toBeNull()
      expect(screen.getByRole('link', { name: '聊天' })).toHaveAttribute(
        'href',
        '/zh-CN/workbench?mode=chat',
      )
    },
  )
  it.each(['work', 'expert'])('%s 缺电脑，直接引导接入', async (mode) => {
    navigation.query = `mode=${mode}`
    page(<HomeScreen />)
    await screen.findByText(zh.home.blocker.noMachine)
    checkLink()
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })
  it('主页「专家」里，「请哪一位」旁边就有「请我的分身」，去 knowmart 选（所有者 2026-10-18）', async () => {
    navigation.query = 'mode=expert'
    page(<HomeScreen />)
    const link = await screen.findByRole('link', { name: zh.home.expert.summon })
    expect(link.getAttribute('href')).toBe(
      'https://knowmart.example.test/zh-CN/knowbots?from=knowbench&ref=expert',
    )
  })

  it('专家首页与指定项目的专家页都能接入', async () => {
    const p = page(<ExpertHomeScreen />)
    await screen.findByText(zh.expertHome.noMachine)
    checkLink()
    p.rerender(<AskExpertScreen project="fixture-project" from={null} expert={null} />)
    await screen.findByText(zh.askExpert.blocker.noMachine)
    checkLink()
    expect(screen.getByRole('button', { name: '交给专家' })).toBeDisabled()
  })
  it('侧栏状态是可见链接，聊天导航明确指向聊天入口', async () => {
    page(<Sidebar />)
    // 没有电脑：中段只一行，带去设置页的链接；底部不再有「我的电脑」（0016）
    await screen.findByText(/还没有接入电脑/)
    expect(screen.getByRole('link', { name: '去接入' })).toHaveAttribute(
      'href',
      '/zh-CN/workbench/settings/computer',
    )
    expect(screen.queryByText('我的电脑')).toBeNull()
    expect(screen.getByRole('link', { name: '聊天' })).toHaveAttribute(
      'href',
      '/zh-CN/workbench?mode=chat',
    )
  })
  it('侧栏树：工作区行有「全部」和「+」，项目与对话行有删除，确认后才发请求（0016，所有者 2026-10-12 定）', async () => {
    environment = 'full'
    const base = globalThis.fetch
    const removed: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        if (init.method === 'DELETE') {
          removed.push(String(input))
          return new Response(null, { status: 204 })
        }
        // 这个文件的公共桩只让「电脑」按 full 回；树还要工作区、项目、对话
        const path = String(input).split('?')[0]
        if (
          [
            '/api/workbench/workspaces',
            '/api/workbench/projects',
            '/api/workbench/sessions',
          ].includes(path)
        ) {
          return Response.json(fixture('full', path))
        }
        return base(input, init)
      }),
    )
    page(<Sidebar />)
    const workspaceKey = encodeURIComponent(
      '0f79a87c-7bf3-5956-be15-01e3988797ee\n/home/demo/research',
    )
    await screen.findByText('办公室的电脑')
    const all = await screen.findAllByRole('link', { name: '全部' })
    expect(all[0]).toHaveAttribute('href', `/zh-CN/workbench/projects?workspace=${workspaceKey}`)
    expect(screen.getByRole('link', { name: '在 research 里新建项目' })).toHaveAttribute(
      'href',
      `/zh-CN/workbench/projects?workspace=${workspaceKey}&new=1`,
    )
    // 顶上不再有总的「全部」，项目行不再有「更多」
    expect(screen.queryByRole('link', { name: /的更多$/ })).toBeNull()
    // 工作区按个人偏好默认展开（0021）；没展开就点开 research
    const research = screen.getByRole('button', { name: 'research' })
    if (research.getAttribute('aria-expanded') !== 'true') fireEvent.click(research)
    // 项目行的「+」不弹菜单，直接去右边的新建框，项目已选好（所有者 2026-10-12 实测定）
    expect(screen.getByRole('link', { name: '在 上海机场 里新建' })).toHaveAttribute(
      'href',
      '/zh-CN/workbench?mode=work&project=f0410883-287b-578b-81dc-15f24e5b2d8f',
    )
    expect(screen.queryByRole('button', { name: /里新建$/ })).toBeNull()
    // 项目行：先问一句，取消不发请求；确定才发 DELETE
    fireEvent.click(screen.getByRole('button', { name: '删除项目 上海机场' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(removed).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '删除项目 上海机场' }))
    fireEvent.click(screen.getByRole('button', { name: '确定删除' }))
    await waitFor(() =>
      expect(removed).toEqual(['/api/workbench/projects/f0410883-287b-578b-81dc-15f24e5b2d8f']),
    )
    // 「最近」里的对话也能删（所有者 2026-10-14）：同样先问一句，确定才发 DELETE
    const latest = within(screen.getByRole('region', { name: '最近' }))
    fireEvent.click(latest.getAllByRole('button', { name: /^删除对话 / })[0])
    expect(screen.getAllByRole('button', { name: '确定删除' })).toHaveLength(1)
    fireEvent.click(latest.getByRole('button', { name: '确定删除' }))
    await waitFor(() =>
      expect(removed.filter((path) => path.startsWith('/api/workbench/sessions/'))).toHaveLength(1),
    )
  })
  it.each(['pending', 'error'] as const)('新建项目 %s 不误报没有电脑或创建项目', async (state) => {
    environment = state
    page(<NewProjectDialog open onOpenChange={() => {}} onCreated={() => {}} />)
    await screen.findByText(
      state === 'pending' ? zh.projects.create.loadingMachines : zh.projects.create.machinesFailed,
    )
    expect(screen.queryByRole('link', { name: '接入电脑' })).toBeNull()
    expect(screen.getByRole('button', { name: zh.projects.create.submit })).toBeDisabled()
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })
})

describe('三步引导证据', () => {
  it('电脑已在线，三步都算完成，没有自己打勾', async () => {
    issuedIdentity = false
    environment = 'full'
    page(<MachinesScreen />)
    const guide = within(screen.getByRole('region', { name: zh.machines.guide.title }))
    await waitFor(() => expect(guide.getAllByLabelText('已完成')).toHaveLength(3))
    expect(guide.getByText(zh.machines.guide.evidence)).toHaveTextContent(
      '本地 link 连着，这三步就算完成',
    )
    expect(guide.queryAllByRole('checkbox')).toHaveLength(0)
  })
  it('没有电脑时三步都没做；离线算安装和选文件夹；在线三步完成', async () => {
    const p = page(<MachinesScreen />)
    const guide = within(screen.getByRole('region', { name: zh.machines.guide.title }))
    await waitFor(() => expect(guide.getAllByLabelText('还没做')).toHaveLength(3))
    expect(guide.getAllByRole('link').map((link) => link.textContent)).toEqual([
      '1. 下载安装',
      '2. 装完后电脑会自动打开本站这一页并带上确认码，核对电脑名后点允许，给本地 link 颁发令牌',
      '3. 选文件夹完成',
    ])
    expect(await screen.findByRole('button', { name: '复制安装命令' })).toBeVisible()
    expect(screen.getByRole('link', { name: '下载 Windows ZIP' })).toHaveAttribute(
      'href',
      release.url,
    )
    act(() =>
      p.client.setQueryData(
        workbenchKeys.machines,
        connected.map((m: object) => ({ ...m, status: 'offline' })),
      ),
    )
    await waitFor(() => expect(guide.getAllByLabelText('已完成')).toHaveLength(2))
    act(() => p.client.setQueryData(workbenchKeys.machines, connected))
    await waitFor(() => expect(guide.getAllByLabelText('已完成')).toHaveLength(3))
    const sections = [...document.querySelectorAll('section[id]')].map((s) => s.id)
    // 一个账号一台电脑：顶上那块就是那台电脑的全部，不再另列「已经接入的电脑」
    expect(sections).toEqual(['computer', 'computer-status', 'agent-download', 'agent-connect'])
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })
  it('地址里带着码就自动核对，用户只剩点允许', async () => {
    navigation.query = 'code=ab3d7k9q'
    const base = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        if (String(input) === '/api/workbench/agent-pairing/lookup' && init.method === 'POST') {
          calls.push({ path: String(input), method: 'POST' })
          expect(JSON.parse(String(init.body))).toEqual({ user_code: 'AB3D-7K9Q' })
          return Response.json({
            id: '6f1c2b1e-3c5d-4a7e-9b8f-0d1e2f3a4b5c',
            machine_name: '书房电脑',
            os: 'Windows 11',
            agent_version: '0.3.0',
            codex_version: '0.155.1',
            source_ip: null,
            requested_seconds_ago: 3,
            replaces_machine: null,
          })
        }
        return base(input, init)
      }),
    )
    page(<MachinesScreen />)
    expect(await screen.findByText('书房电脑')).toBeVisible()
    expect(screen.getByText(zh.machines.connect.prefilled)).toBeVisible()
    expect(screen.getByRole('button', { name: zh.machines.connect.allow })).toBeVisible()
    expect((screen.getByLabelText(zh.machines.connect.code) as HTMLInputElement).value).toBe(
      'AB3D-7K9Q',
    )
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })
  it('电脑状态失败不显示未登记或在线通过', async () => {
    environment = 'error'
    page(<MachinesScreen />)
    await screen.findByText(zh.machines.loadFailed)
    expect(screen.queryByText(zh.machines.none)).toBeNull()
    const guide = within(screen.getByRole('region', { name: zh.machines.guide.title }))
    expect(guide.getAllByLabelText('还没做')).toHaveLength(3)
  })
})
