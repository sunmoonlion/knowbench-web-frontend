import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NewProjectDialog } from '@/features/projects/ui/new-project-dialog'
import { WorkbenchProvider } from '@/lib/workbench/context'
import { forgetTicket } from '@/lib/workbench/local-agent'
import messages from '@/messages/zh-CN.json'

const t = messages.projects.create
const ENV = '33333333-3333-4333-8333-333333333333'
const PROJECT = '44444444-4444-4444-8444-444444444444'
const ROOT = 'C:\\Users\\zymun\\Desktop'
const LOCAL = 'http://127.0.0.1:47811'

type Call = {
  url: string
  method: string
  body: Record<string, unknown> | null
  auth: string | null
}
let calls: Call[] = []
let capabilities: string[]
let agentHere: boolean
let clone: (body: Record<string, unknown>) => { status: number; body: unknown }
let serviceCapabilities: string[]

beforeEach(() => {
  calls = []
  capabilities = ['local-fs-v1', 'local-project-v1']
  agentHere = true
  clone = (body) => ({ status: 200, body: { path: body.path, branch: 'main' } })
  serviceCapabilities = ['service-v1', 'service-projects-v1']
  forgetTicket(ENV)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://testserver')
      const where = url.origin + url.pathname
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const headers = (init.headers ?? {}) as Record<string, string>
      calls.push({
        url: where,
        method: init.method ?? 'GET',
        body,
        auth: headers.Authorization ?? null,
      })
      const json = (status: number, value: unknown) => Response.json(value, { status })
      if (where.startsWith('http://127.0.0.1:') && !agentHere) throw new TypeError('refused')
      if (where === 'http://testserver/api/workbench/environments')
        return json(200, {
          environments: [{ id: ENV, name: 'zymun', status: 'online', roots: [ROOT] }],
        })
      if (where === `${LOCAL}/presence`)
        return json(200, {
          agent: 'sunmoon-agent',
          version: '0.4.1',
          machine_name: 'zymun',
          connected: true,
        })
      if (where === `http://testserver/api/workbench/environments/${ENV}/local-ticket`)
        return json(200, {
          ticket: 'h.e.s',
          expires_at: Math.floor(Date.now() / 1000) + 600,
          relay_user: 'u-abc',
        })
      if (where === `${LOCAL}/local/v1/info`)
        return json(200, { userId: 'u-abc', roots: [ROOT], capabilities })
      if (where === `${LOCAL}/local/v1/projects/folder`)
        return json(200, { path: body.path, created: true })
      if (where === `${LOCAL}/local/v1/projects/clone`) {
        const answer = clone(body)
        return json(answer.status, answer.body)
      }
      // 远程登录 link 的电脑（账 165）：经工作台转发给那台电脑上的本地 link
      if (where === `http://testserver/api/workbench/environments/${ENV}/service`)
        return json(200, { roots: [ROOT], capabilities: serviceCapabilities })
      if (where === `http://testserver/api/workbench/environments/${ENV}/remote/projects/folder`)
        return json(200, { path: body.path, created: true })
      if (where === `http://testserver/api/workbench/environments/${ENV}/remote/projects/clone`) {
        const answer = clone(body)
        return json(answer.status, answer.body)
      }
      if (where === 'http://testserver/api/workbench/projects') return json(201, { id: PROJECT })
      return json(404, { code: 'not_found' })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function dialog(onCreated = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf" locale="zh-CN">
          <NewProjectDialog open onOpenChange={() => {}} onCreated={onCreated} />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
  return onCreated
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const posts = () => calls.filter((each) => each.method === 'POST')

describe('新建项目：先请电脑上的代理建好，再登记（0024）', () => {
  it('新建文件夹：代理建好 Windows 路径的文件夹，工作台才登记', async () => {
    const onCreated = dialog()
    fireEvent.change(await screen.findByLabelText(t.path), { target: { value: '财务预测' } })
    const submit = screen.getByRole('button', { name: t.submit })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(PROJECT))
    expect(posts().map((each) => [each.url, each.body])).toEqual([
      [`${LOCAL}/local/v1/projects/folder`, { path: `${ROOT}\\财务预测` }],
      [
        'http://testserver/api/workbench/projects',
        { environment_id: ENV, workspace_root: ROOT, path: '财务预测' },
      ],
    ])
  })

  it('拉取仓库：子目录默认用仓库名；要登录时弹令牌框，令牌只发给本机代理', async () => {
    let tries = 0
    clone = (body) =>
      ++tries === 1
        ? { status: 401, body: { code: 'auth_required', message: 'auth_required' } }
        : { status: 200, body: { path: body.path, branch: 'main' } }
    const onCreated = dialog()
    fireEvent.click(await screen.findByRole('button', { name: t.modeClone }))
    type(t.repo, 'https://example.com/team/report.git')
    expect(screen.getByText(`${ROOT}\\report`)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: t.submitClone })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    expect(await screen.findByText(t.auth.title)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(t.problem.auth_required)
    const retry = screen.getByRole('button', { name: t.auth.retry })
    expect(retry).toBeDisabled()
    type(t.auth.token, 'tok-secret')
    fireEvent.click(screen.getByLabelText(t.auth.remember))
    fireEvent.click(retry)
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(PROJECT))
    const clones = posts().filter((each) => each.url.endsWith('/projects/clone'))
    expect(clones.map((each) => each.body)).toEqual([
      { url: 'https://example.com/team/report.git', path: `${ROOT}\\report` },
      {
        url: 'https://example.com/team/report.git',
        path: `${ROOT}\\report`,
        auth: { token: 'tok-secret', remember: true },
      },
    ])
    // 令牌没去工作台
    for (const each of calls.filter((each) => each.url.startsWith('http://testserver')))
      expect(JSON.stringify(each.body ?? {})).not.toContain('tok-secret')
    expect(posts().at(-1)?.body).toEqual({
      environment_id: ENV,
      workspace_root: ROOT,
      path: 'report',
    })
  })

  it('拉取失败说出原因，不登记', async () => {
    clone = () => ({ status: 409, body: { code: 'target_not_empty', message: 'target_not_empty' } })
    dialog()
    fireEvent.click(await screen.findByRole('button', { name: t.modeClone }))
    type(t.repo, 'git@example.com:team/report.git')
    const submit = screen.getByRole('button', { name: t.submitClone })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    expect(await screen.findByText(t.problem.target_not_empty)).toBeInTheDocument()
    expect(screen.queryByText(t.auth.title)).toBeNull()
    expect(calls.some((each) => each.url.endsWith('/api/workbench/projects'))).toBe(false)
  })

  it('这台电脑上没有本地 link：是远程登录 link 的电脑，项目经工作台转发建在那台电脑上', async () => {
    agentHere = false
    const onCreated = dialog()
    expect(await screen.findByText(t.agent.remote)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(t.path), { target: { value: '财务预测' } })
    const submit = screen.getByRole('button', { name: t.submit })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(PROJECT))
    expect(posts().map((each) => each.url)).toEqual([
      `http://testserver/api/workbench/environments/${ENV}/remote/projects/folder`,
      'http://testserver/api/workbench/projects',
    ])
  })

  it('远程拉私有仓库：先用那台电脑 git 现有的登录；要令牌时提醒令牌经云端转发', async () => {
    agentHere = false
    let tries = 0
    clone = (body) =>
      ++tries === 1
        ? { status: 401, body: { code: 'auth_required', message: 'auth_required' } }
        : { status: 200, body: { path: body.path, branch: 'main' } }
    const onCreated = dialog()
    fireEvent.click(await screen.findByRole('button', { name: t.modeClone }))
    type(t.repo, 'https://example.com/team/report.git')
    const submit = screen.getByRole('button', { name: t.submitClone })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    expect(await screen.findByText(t.auth.remoteLead)).toBeInTheDocument()
    expect(screen.queryByText(t.auth.lead)).toBeNull()
    type(t.auth.token, 'tok-secret')
    fireEvent.click(screen.getByRole('button', { name: t.auth.retry }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(PROJECT))
    const clones = posts().filter((each) => each.url.endsWith('/remote/projects/clone'))
    expect(clones.map((each) => each.body)).toEqual([
      { url: 'https://example.com/team/report.git', path: `${ROOT}\\report` },
      {
        url: 'https://example.com/team/report.git',
        path: `${ROOT}\\report`,
        auth: { token: 'tok-secret', remember: false },
      },
    ])
  })

  it('远程而那台电脑上的本地 link 是旧版：请更新到 0.5.2，不能建', async () => {
    agentHere = false
    serviceCapabilities = ['service-v1']
    dialog()
    expect(await screen.findByText(t.agent.remoteOutdated)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.submit })).toBeDisabled()
    expect(posts()).toEqual([])
  })

  it('代理没有新建项目的口（0.4.0）：请更新代理', async () => {
    capabilities = ['local-fs-v1']
    dialog()
    expect(await screen.findByText(t.agent.outdated)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.submit })).toBeDisabled()
  })
})
