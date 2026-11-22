import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { MethodSkillCenterSection } from '@/features/settings/ui/method-skill-center-section'
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
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={zh} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf" locale="zh-CN">
          <MethodSkillCenterSection />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}
afterEach(() => vi.restoreAllMocks())
it('keeps source and method identities visible and confirms before disabling the exact revision', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.installed }))
  expect(await screen.findByText('工作邮件')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '查看安装入口' }))
  expect(await screen.findByText('send')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.disable }))
  expect(screen.getByText(/直接引用它的已登记版本有 2 个/)).toBeVisible()
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.disable }))
  await waitFor(() => expect(change).toHaveBeenCalledWith(asset_id, 3, 'disable', 'csrf'))
  fireEvent.click(screen.getByRole('button', { name: '正式方法' }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '发送成稿' } })
  expect(screen.getByRole('heading', { name: /发送成稿/ })).toBeVisible()
  expect(screen.queryByRole('heading', { name: /对账通知/ })).toBeNull()
  expect(await screen.findByText(/当前安装已停用/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Codex 原生动作' }))
  expect(screen.getByText('item/permissions/requestApproval')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '最近记录' }))
  expect(await screen.findByText(/正式方法 · send/)).toBeVisible()
  fireEvent.click(screen.getByText(zh.methodSkillCenter.trace))
  expect(screen.getByText(new RegExp(methods[0].reference.digest))).toBeVisible()
})
it('lists an expert with no installation and shows who runs each of its leaves', async () => {
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
  renderPage()
  expect(await screen.findByText(zh.methodSkillCenter.empty)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.installed }))
  expect(screen.getByRole('link', { name: '安装技能' })).toHaveAttribute(
    'href',
    '/zh-CN/workbench/settings/skills',
  )
})

it('withdraws a direct source from its latest revision after confirmation', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: zh.methodSkillCenter.sources }))
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
