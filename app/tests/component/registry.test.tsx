import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { RegistrySection } from '@/features/settings/ui/registry-section'
import { WorkbenchProvider } from '@/lib/workbench/context'
import zh from '@/messages/zh-CN.json'
import * as registry from '@/lib/workbench/registry'
import * as api from '@/lib/workbench/capabilities'

const asset_id = '088208b5-a2b2-4f7b-a2b8-b5abdedff75d'
const asset: registry.RegistryAsset = {
  asset_id,
  revision: 3,
  name: '工作邮件',
  account_label: 'mail@example.test',
  status: 'active',
  kind: 'connection',
}
const methods: registry.RegisteredMethod[] = ['发送成稿', '发送对账通知'].map((title, i) => ({
  path: 'formal',
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
          <RegistrySection />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}
afterEach(() => vi.restoreAllMocks())
it('keeps source and method identities visible and confirms before disabling the exact revision', async () => {
  let status = asset.status
  vi.spyOn(registry, 'registryInventory').mockImplementation(async () => ({
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
  vi.spyOn(registry, 'registryInstallation').mockResolvedValue({
    path: 'installed',
    ...asset,
    entries: [{ kind: 'mcp', entry: 'send', tool_key: 'opaque' }],
  })
  vi.spyOn(registry, 'registryActivity').mockResolvedValue([
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
  fireEvent.click(screen.getByText(zh.registry.trace))
  expect(screen.getByText(new RegExp(methods[0].reference.digest))).toBeVisible()
})
it('shows an empty registry with working installation links', async () => {
  vi.spyOn(registry, 'registryInventory').mockResolvedValue({
    installed: [],
    formal: [],
    native: [],
  })
  renderPage()
  expect(await screen.findByText(zh.registry.empty)).toBeVisible()
  expect(screen.getByRole('link', { name: '安装技能' })).toHaveAttribute(
    'href',
    '/zh-CN/workbench/settings/skills',
  )
})
