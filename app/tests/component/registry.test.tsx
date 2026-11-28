import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { PlanningMethods } from '@/components/workbench/planning-methods'
import { MethodSkillCenterSection } from '@/features/methods'
import { WorkbenchProvider } from '@/lib/workbench/context'
import zh from '@/messages/zh-CN.json'
import * as registry from '@/lib/workbench/method-skill-center'
import * as api from '@/lib/workbench/capabilities'

const asset_id = '088208b5-a2b2-4f7b-a2b8-b5abdedff75d'
const asset: registry.MethodSkillCenterAsset = {
  asset_id,
  revision: 3,
  name: '工作邮件',
  account_label: 'mail@example.test',
  status: 'active',
  kind: 'connection',
}
const methods: registry.RegisteredMethod[] = ['发送成稿', '发送对账通知'].map((title, i) => ({
  path: 'formal',
  method_kind: 'tool',
  runner_route: 'formal_mcp',
  allowed_callers: ['host', 'model'],
  title,
  reference: {
    method_id: 'b5ae2229-dfbc-46ac-9c30-895e75571c0' + i,
    version: 1,
    digest: 'sha256:' + 'f'.repeat(64),
  },
  source_asset_id: asset_id,
  source_revision: 3,
  source_kind: 'mcp',
  source_digest: 'sha256:' + 'd'.repeat(64),
  source_entry: 'send',
  dependencies: [],
}))
function renderPage(view = <MethodSkillCenterSection />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={zh} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf" locale="zh-CN">
          {view}
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}
afterEach(() => vi.restoreAllMocks())

it('presents 3 clean user views, confirms connector disable impact, and folds native diagnostics under activity', async () => {
  let status = asset.status
  vi.spyOn(registry, 'methodSkillCenterInventory').mockImplementation(async () => ({
    installed: [{ ...asset, status }],
    formal: methods,
    native: [
      {
        name: 'permissions',
        request: 'item/permissions/requestApproval',
        item_type: null,
        interaction: 'approval',
      },
    ],
  }))
  vi.spyOn(registry, 'listSources').mockResolvedValue([])
  vi.spyOn(registry, 'methodSkillCenterInstallation').mockResolvedValue({
    path: 'installed',
    ...asset,
    entries: [{ kind: 'mcp', entry: 'send', tool_key: 'opaque' }],
  })
  vi.spyOn(registry, 'methodSkillCenterActivity').mockResolvedValue([
    {
      kind: 'call',
      path: 'formal',
      record_id: 'approved-call',
      session_id: asset_id,
      asset_id,
      reference: methods[0].reference,
      action: 'send',
      status: 'completed',
      at: '2026-11-21T03:00:00Z',
    },
  ])
  const change = vi.spyOn(api, 'assetAction').mockImplementation(async () => {
    status = 'disabled'
    return {
      ...asset,
      id: asset_id,
      status,
      default_selected: false,
      detail: {},
      created_at: '',
      updated_at: '',
    }
  })
  renderPage()
  expect(await screen.findByRole('heading', { name: /发送成稿/ })).toBeVisible()
  expect(screen.getAllByText(/工具方法 · MCP/)).toHaveLength(2)

  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.tabs.installed }))
  expect(await screen.findByText('工作邮件')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '查看安装入口' }))
  expect(await screen.findByText('send')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.disable }))
  expect(screen.getByText(/直接引用它的已登记版本有 2 个/)).toBeVisible()
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.disable }))
  await waitFor(() => expect(change).toHaveBeenCalledWith(asset_id, 3, 'disable', 'csrf'))

  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.tabs.formal }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '发送成稿' } })
  expect(screen.getByRole('heading', { name: /发送成稿/ })).toBeVisible()
  expect(screen.queryByRole('heading', { name: /对账通知/ })).toBeNull()
  expect(await screen.findByText(/当前安装已停用/)).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.tabs.activity }))
  expect(await screen.findByText(/正式方法 · send/)).toBeVisible()
  fireEvent.click(screen.getByText(zh.methodSkillCenter.trace))
  expect(screen.getByText(new RegExp(methods[0].reference.digest))).toBeVisible()
  fireEvent.click(screen.getByText(zh.methodSkillCenter.protocolDiagnostics))
  expect(screen.getByText('item/permissions/requestApproval')).toBeVisible()
})

it('lists an expert with direct summon link and shows who runs each of its leaves', async () => {
  const leaves: registry.RegisteredMethod[] = methods.map((m, i) => ({
    ...m,
    title: i ? '复核指令' : '汇总脚本',
    source_kind: i ? 'skill_instruction' : 'skill_script',
    runner_route: i ? 'formal_instruction' : 'formal_script',
    allowed_callers: ['host'],
  }))
  vi.spyOn(registry, 'methodSkillCenterInventory').mockResolvedValue({
    installed: [],
    native: [],
    formal: [
      ...leaves,
      {
        ...methods[0],
        title: '月末专家',
        method_kind: 'expert',
        runner_route: 'orchestration',
        reference: { ...methods[0].reference, version: 2 },
        source_kind: null,
        source_asset_id: null,
        source_entry: null,
        source_revision: null,
        source_digest: null,
        dependencies: leaves.map((m) => m.reference),
      },
    ],
  })
  renderPage()
  expect(await screen.findByRole('heading', { name: /月末专家/ })).toBeVisible()
  expect(screen.getByRole('link', { name: zh.methodSkillCenter.askVersion })).toHaveAttribute(
    'href',
    expect.stringContaining('/zh-CN/workbench?mode=expert&formalReference='),
  )
  expect(screen.getByText(/专家方法 · runtime/)).toBeVisible()
  expect(screen.getByText(/工具方法 · 隔离脚本/)).toBeVisible()
  expect(screen.getByText(/工具方法 · 隔离模型/)).toBeVisible()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '专家方法' } })
  expect(screen.getByRole('heading', { name: /月末专家/ })).toBeVisible()
  expect(screen.queryByRole('heading', { name: /汇总脚本/ })).toBeNull()
})

it('shows an empty registry with working installation links', async () => {
  vi.spyOn(registry, 'methodSkillCenterInventory').mockResolvedValue({
    installed: [],
    formal: [],
    native: [],
  })
  vi.spyOn(registry, 'listSources').mockResolvedValue([])
  renderPage()
  expect(await screen.findByText(zh.methodSkillCenter.empty)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.tabs.installed }))
  expect(screen.getByRole('link', { name: '安装技能' })).toHaveAttribute(
    'href',
    '/zh-CN/workbench/settings/skills',
  )
})

it('withdraws a direct source from its latest revision inside the unified local skills tab', async () => {
  vi.spyOn(registry, 'methodSkillCenterInventory').mockResolvedValue({
    installed: [],
    formal: [],
    native: [],
  })
  const row: registry.DirectSource = {
    source_id: asset_id,
    version: 2,
    digest: 'sha256:' + 'b'.repeat(64),
    kind: 'instruction',
    name: '回执',
  }
  let rows = [row, { ...row, version: 1 }]
  vi.spyOn(registry, 'listSources').mockImplementation(async () => rows)
  vi.spyOn(registry, 'loadSource').mockImplementation(async (r) => ({ ...r, content: 'test' }))
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  const withdraw = vi.spyOn(registry, 'withdrawSource').mockImplementation(async () => {
    rows = []
    return { withdrawn: true }
  })
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: zh.methodSkillCenter.tabs.installed }))
  fireEvent.click(await screen.findByRole('button', { name: /回执 · v1/ }))
  await screen.findByText('test')
  expect(screen.queryByRole('button', { name: zh.directRegistry.withdraw })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /回执 · v2/ }))
  const button = await screen.findByRole('button', { name: zh.directRegistry.withdraw })
  fireEvent.click(button)
  expect(withdraw).not.toHaveBeenCalled()
  fireEvent.click(button)
  await screen.findByText(zh.directRegistry.empty)
  expect(withdraw).toHaveBeenCalledWith(row, 'csrf')
})

it('uses the current question and hands its exact version to the planning draft on selection', async () => {
  const pick = vi.fn()
  const { reference, title } = methods[0]
  const query = vi.spyOn(registry, 'methodSkillCenterPlanningMethods').mockResolvedValue({
    items: [
      {
        method_id: reference.method_id,
        latest_version: reference.version,
        digest: reference.digest,
        title,
        summary: '按原行核对',
        method_kind: 'tool',
      },
    ],
    next: null,
  })
  const facets = [
    {
      code: 'financial.reconciliation',
      name: '报表勾稽',
      group: 'financial',
      group_name: '财务核验',
      count: 1,
    },
  ]
  const response = {
    categories: facets,
    total: 1,
    next: null,
    items: [
      {
        method_id: reference.method_id,
        latest_version: reference.version,
        digest: reference.digest,
        method_kind: 'tool' as const,
        title,
        summary: '核对',
        category: 'financial.reconciliation',
        usable: true,
      },
    ],
  }
  const browse = vi.spyOn(registry, 'browsePlanningDirectory').mockResolvedValue(response)
  renderPage(<PlanningMethods forQuestion="核对原行" onPick={pick} />)
  const choose = await screen.findByRole('button', { name: zh.methodSkillCenter.chooseVersion })
  expect(query).toHaveBeenCalledWith(0, { stage: 'composition', question: '核对原行' }, 'csrf')
  expect(pick).not.toHaveBeenCalled()
  fireEvent.click(choose)
  expect(pick).toHaveBeenCalledWith({ reference, title })
  fireEvent.change(screen.getByLabelText(zh.directoryFacets.kind), { target: { value: 'tool' } })
  await screen.findByRole('option', { name: '财务核验' })
  fireEvent.change(screen.getByLabelText(zh.directoryFacets.group), {
    target: { value: 'financial' },
  })
  await screen.findByRole('option', { name: '报表勾稽' })
  fireEvent.change(screen.getByLabelText(zh.directoryFacets.category), {
    target: { value: 'financial.reconciliation' },
  })
  expect(await screen.findByText('共 1 项')).toBeVisible()
  expect(browse).toHaveBeenLastCalledWith(
    { kind: 'tool', group: 'financial', category: 'financial.reconciliation' },
    0,
    { stage: 'composition', question: '核对原行' },
    'csrf',
  )
})

it('安装修订不一致时要求刷新，隐藏新版入口', async () => {
  vi.spyOn(registry, 'methodSkillCenterInventory').mockResolvedValue({
    installed: [asset], formal: methods, native: [],
  })
  vi.spyOn(registry, 'methodSkillCenterInstallation').mockResolvedValue({
    path: 'installed', asset_id, revision: 4, status: 'active',
    entries: [{ kind: 'mcp', entry: 'revision-four-only', tool_key: null }],
  })
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.tabs.installed }))
  fireEvent.click(await screen.findByRole('button', { name: '查看安装入口' }))
  expect(await screen.findByText(zh.methodSkillCenter.installationChanged)).toBeVisible()
  expect(screen.queryByText('revision-four-only')).toBeNull()
})

it('清单请求失败时仍可读取最近活动', async () => {
  vi.spyOn(registry, 'methodSkillCenterInventory').mockRejectedValue(new Error('inventory offline'))
  const activity = vi.spyOn(registry, 'methodSkillCenterActivity').mockResolvedValue([])
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.tabs.activity }))
  await screen.findByRole('alert')
  expect(activity).toHaveBeenCalled()
})

it('按问题找到专家后将冻结的检索问题随版本带到首页', async () => {
  const { reference, title } = methods[0]
  const question = '核对当前季度与去年同期的收入'
  vi.spyOn(registry, 'methodSkillCenterPlanningMethods').mockImplementation(async (_, basis) => ({
    items: basis.stage === 'directory' ? [] : [{
      method_id: reference.method_id, latest_version: reference.version,
      digest: reference.digest, method_kind: 'expert', title, summary: '核对季度数据',
    }], next: null,
  }))
  renderPage(<PlanningMethods />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.searchExperts }))
  const link = await screen.findByRole('link', { name: zh.methodSkillCenter.askVersion })
  const params = new URL(link.getAttribute('href')!, 'https://example.test').searchParams
  expect(JSON.parse(params.get('formalReference')!)).toEqual(reference)
  expect(new URLSearchParams(new URL(link.getAttribute('href')!, 'https://example.test').hash.slice(1)).get('question')).toBe(question)
})
