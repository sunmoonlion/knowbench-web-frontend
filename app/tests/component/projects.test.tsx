import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectListScreen, ProjectScreen } from '@/features/projects'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/zh-CN/workbench/projects',
}))

const fixtures = join(process.cwd(), 'preview/fixtures')
let scenario = 'full'
function manifestOf(name: string) {
  return JSON.parse(readFileSync(join(fixtures, name, 'manifest.json'), 'utf8')) as {
    pages: { title: string; path: string }[]
    responses: { method: string; path: string; query: string; file: string }[]
  }
}
function sample(path: string, query: string): unknown {
  const found = manifestOf(scenario).responses.find(
    (each) => each.method === 'GET' && each.path === path && each.query === query,
  )
  return found ? JSON.parse(readFileSync(join(fixtures, scenario, found.file), 'utf8')) : null
}

type Call = { method: string; path: string; body: Record<string, unknown> }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  scenario = 'full'
  push.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const [path, query = ''] = String(input).split('?')
      const method = init.method ?? 'GET'
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
      // 这台电脑上的代理（0024：新建项目先请它建好文件夹）
      if (path === 'http://127.0.0.1:47811/presence')
        return json({
          agent: 'sunmoon-agent',
          version: '0.4.1',
          machine_name: 'demo',
          connected: true,
        })
      if (/^\/api\/workbench\/environments\/[^/]+\/local-ticket$/.test(path))
        return json({
          ticket: 'h.e.s',
          expires_at: Math.floor(Date.now() / 1000) + 600,
          relay_user: 'u-demo',
        })
      if (path === 'http://127.0.0.1:47811/local/v1/info')
        return json({
          userId: 'u-demo',
          roots: ['/home/demo/research'],
          capabilities: ['local-fs-v1', 'local-project-v1'],
        })
      if (path === 'http://127.0.0.1:47811/local/v1/projects/folder') {
        const body = JSON.parse(String(init.body))
        calls.push({ method, path, body })
        return json({ path: body.path, created: true })
      }
      if (method !== 'GET') {
        calls.push({ method, path, body: JSON.parse(String(init.body ?? '{}')) })
        return new Response(JSON.stringify({ id: '33333333-3333-4333-8333-333333333333' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const body = sample(path, query)
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

describe('项目列表', () => {
  it('按工作区分组；归档的默认不显示，勾上才显示', async () => {
    page(<ProjectListScreen />)
    const research = within(
      await screen.findByRole('region', { name: '办公室的电脑 /home/demo/research' }),
    )
    expect(research.getAllByRole('link')).toHaveLength(9)
    expect(research.getByText('/home/demo/research/恒瑞医药')).toBeInTheDocument()
    // 另一个工作区里还没有项目：也列出来，写明是空的
    const notes = within(screen.getByRole('region', { name: '办公室的电脑 /home/demo/notes' }))
    expect(notes.getByText('这个工作区里还没有项目。')).toBeInTheDocument()
    expect(screen.queryByText('已归档')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '显示归档的' }))
    expect(await screen.findByText('已归档')).toBeInTheDocument()
  })

  it('新建项目：选工作区、填子目录；不填名字就用目录的最后一段', async () => {
    page(<ProjectListScreen />)
    const create = await screen.findByRole('button', { name: '新建项目' })
    await waitFor(() => expect(create).toBeEnabled()) // 工作区取到了才能建
    fireEvent.click(create)
    // 只有一台机器：不用选机器
    expect(screen.queryByText('在哪台机器上')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '/home/demo/research' }))
    const path = screen.getByLabelText('子目录')
    fireEvent.change(path, { target: { value: '../外面' } })
    expect(screen.getByRole('alert')).toHaveTextContent('不能往上走')
    expect(screen.getByRole('button', { name: '建立' })).toBeDisabled()
    fireEvent.change(path, { target: { value: '医药/恒瑞二期' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '建立' })).toBeEnabled())
    expect(screen.getByText('/home/demo/research/医药/恒瑞二期')).toBeInTheDocument()
    expect(screen.getByText('不填就用目录的最后一段：恒瑞二期')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    // 先请电脑上的代理建好文件夹，再登记（0024）
    expect(calls[0]).toEqual({
      method: 'POST',
      path: 'http://127.0.0.1:47811/local/v1/projects/folder',
      body: { path: '/home/demo/research/医药/恒瑞二期' },
    })
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/api/workbench/projects' })
    expect(calls[1].body).toMatchObject({
      workspace_root: '/home/demo/research',
      path: '医药/恒瑞二期',
    })
    expect('title' in calls[1].body).toBe(false)
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/zh-CN/workbench/projects/33333333-3333-4333-8333-333333333333',
      ),
    )
  })

  it('一个工作区都没有：说明三种原因和去哪里处理', async () => {
    scenario = 'empty'
    page(<ProjectListScreen />)
    expect(await screen.findByText('还没有工作区')).toBeInTheDocument()
    expect(screen.getByText(/还没有接入本地代理/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '接入电脑' })).toHaveAttribute(
      'href',
      '/zh-CN/workbench/settings/computer',
    )
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(await dialog.findByText('先接入电脑并选择项目目录，再创建项目。')).toBeVisible()
    expect(dialog.getByRole('link', { name: '接入电脑' })).toHaveAttribute(
      'href',
      '/zh-CN/workbench/settings/computer',
    )
    expect(calls).toHaveLength(0)
  })
})

describe('项目页', () => {
  const idOf = (name: string, title: string) =>
    manifestOf(name)
      .pages.find((each) => each.title.startsWith(title))!
      .path.split('/')[4]

  it('对话、专家交回；三种开始的办法', async () => {
    const id = idOf('full', '项目页')
    page(<ProjectScreen project={id} />)
    expect(await screen.findByRole('button', { name: '恒瑞医药' })).toBeInTheDocument()
    expect(screen.getByText(/一个项目是你电脑上的一个文件夹/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '新聊天' })).toHaveAttribute(
      'href',
      `/zh-CN/workbench?mode=chat&project=${id}`,
    )
    expect(screen.getByRole('link', { name: '请专家' })).toHaveAttribute(
      'href',
      `/zh-CN/workbench/projects/${id}/expert/new`,
    )
    const conversations = within(screen.getByRole('region', { name: '对话' }))
    expect(conversations.getAllByRole('link')).toHaveLength(3)
    // 专家交回：专家的名字、终态的白话、花了多少；点开回到那段对话。没有代号
    const dossiers = within(screen.getByRole('region', { name: '专家交回' }))
    expect(dossiers.getAllByRole('link')[0].getAttribute('href')).toMatch(/\/projects\/.+\/c\/.+/)
    expect(dossiers.getByText('财报体检')).toBeInTheDocument()
    expect(dossiers.getByText('已完成')).toBeInTheDocument()
    expect(dossiers.getByText('¥0.400')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('FIN_REVIEW')
    // 项目页也有右栏：看这个项目的文件，不用先进某段对话（所有者 2026-10-18）；终端 10-23 去掉
    const rail = screen.getByRole('complementary', { name: '结果' })
    expect(within(rail).getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: '终端' })).toBeNull()
    expect(within(rail).queryByRole('button', { name: '改动' })).toBeNull()
  })

  it('机器离线：可以看、可以聊天，不能新建工作、不能请专家', async () => {
    scenario = 'offline'
    page(<ProjectScreen project={idOf('offline', '项目页')} />)
    expect(await screen.findByText(/机器不在线/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '新聊天' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('link', { name: '新工作' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('link', { name: '请专家' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('归档：先问一句，说明归档之后怎样；确认才归档', async () => {
    const id = idOf('full', '项目页')
    page(<ProjectScreen project={id} />)
    fireEvent.click(await screen.findByRole('button', { name: '归档' }))
    expect(await screen.findByText('归档这个项目？')).toBeInTheDocument()
    expect(screen.getByText(/你电脑上的文件不受影响/)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: '归档' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      path: `/api/workbench/projects/${id}`,
      body: { archived: true },
    })
  })
})
