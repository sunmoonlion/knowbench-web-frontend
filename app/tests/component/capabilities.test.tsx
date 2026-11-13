import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CapabilitySettings } from '@/features/settings/ui/capabilities-section'
import { CapabilityPanel } from '@/components/workbench/capability-panel'
import { WorkbenchProvider } from '@/lib/workbench/context'
import zh from '@/messages/zh-CN.json'
import fixtures from '@/tests/fixtures/capabilities-v1.samples.json'

vi.mock('next/navigation', () => ({
  usePathname: () => '/zh-CN/workbench/chat/22222222-2222-4222-8222-222222222222',
  useSearchParams: () =>
    new URLSearchParams(
      'returnTo=%2Fzh-CN%2Fworkbench%2Fchat%2F22222222-2222-4222-8222-222222222222',
    ),
}))
let catalog: typeof fixtures.Catalog,
  selection: typeof fixtures.Selection,
  calls: typeof fixtures.Calls
const writes: { path: string; body: Record<string, unknown>; headers: unknown }[] = []
const clients: QueryClient[] = []
function page(child: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={zh} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-fixture" locale="zh-CN">
          {child}
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}
beforeEach(() => {
  catalog = structuredClone(fixtures.Catalog)
  selection = structuredClone(fixtures.Selection)
  calls = structuredClone(fixtures.Calls)
  writes.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input)
      if (init.method && init.method !== 'GET') {
        const body = JSON.parse(String(init.body))
        writes.push({ path, body, headers: init.headers })
        if (path.endsWith('/decision')) {
          calls.calls[0].status = 'succeeded'
          return Response.json(calls.calls[0])
        }
        if (path.endsWith('/actions')) {
          catalog.assets[0].status = 'disconnected'
          return Response.json(catalog.assets[0])
        }
        if (path.endsWith('/skills') || path.endsWith('/skill-packages'))
          return Response.json(catalog.assets[1], { status: 201 })
        if (path.endsWith('/capabilities')) {
          selection = { ...selection, ...body, revision: selection.revision + 1 }
          return Response.json(selection)
        }
      }
      if (path.endsWith('/capability-calls')) return Response.json(calls)
      if (path.includes('/sessions/')) return Response.json(selection)
      if (path.endsWith('/capabilities')) return Response.json(catalog)
      throw new Error(`Unexpected request ${path}`)
    }),
  )
})
afterEach(() => {
  clients.forEach((c) => c.clear())
  clients.length = 0
  vi.unstubAllGlobals()
})

it('lists connection tools, confirms local disconnection, and keeps a return path', async () => {
  page(<CapabilitySettings kind="connection" />)
  expect(await screen.findByText('Office mail')).toBeInTheDocument()
  expect(
    screen.getByText('office@example.test · https://tools.example.test/mcp'),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: zh.capabilities.returnToConversation })).toHaveAttribute(
    'href',
    '/zh-CN/workbench/chat/22222222-2222-4222-8222-222222222222',
  )
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.disconnect }))
  expect(writes).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.confirmDisconnect }))
  await waitFor(() => expect(writes[0]?.body).toEqual({ revision: 1, action: 'disconnect' }))
})

it('imports a pure instruction skill with explicitly chosen connection dependencies', async () => {
  page(<CapabilitySettings kind="skill" />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.add }))
  fireEvent.change(screen.getByLabelText(zh.capabilities.skillName), {
    target: { value: 'new-notice' },
  })
  fireEvent.change(screen.getByLabelText(zh.capabilities.description), {
    target: { value: 'Draft notice' },
  })
  fireEvent.change(screen.getByLabelText(zh.capabilities.instructions), {
    target: { value: 'Validate the recipient before sending.' },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: /Office mail/ }))
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.import }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].body.dependencies).toEqual([fixtures.Selection.tools[0]])
  expect(writes[0].body.content).toBe('Validate the recipient before sending.')
})

it('shows pending operations without opening the panel, then approves exact account and digest', async () => {
  page(<CapabilityPanel sessionId={fixtures.Selection.session_id} />)
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(zh.capabilities.pendingApproval) }),
  )
  expect(await screen.findByText('reader@example.test', { exact: false })).toBeInTheDocument()
  expect(screen.getAllByText(/office@example.test/).length).toBeGreaterThan(0)
  expect(writes).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.allowOnce }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].body).toEqual({
    decision: 'accept',
    token: fixtures.Call.detail.approval_token,
    subject_digest: fixtures.Call.digest,
  })
})

it('keeps frozen method selections read-only', async () => {
  selection.editable = false
  page(<CapabilityPanel sessionId={fixtures.Selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  expect(await screen.findByText(zh.capabilities.methodFrozen)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: zh.capabilities.saveSelection })).toBeDisabled()
})

it('lets the user remove disabled selections and save a revision-bound empty scope', async () => {
  selection.available_tools[0].status = 'disabled'
  page(<CapabilityPanel sessionId={fixtures.Selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.clearSelection }))
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
  await waitFor(() =>
    expect(writes[0]?.body).toEqual({
      revision: 1,
      tools: [],
      skills: [],
      purpose: 'Notify reader',
      skill_mode: 'explicit',
    }),
  )
})

it('offers automatic discovery without selecting every skill and can restrict the scope', async () => {
  // Fixture represents explicit scope; switching to automatic clears the pinned list.
  page(<CapabilityPanel sessionId={fixtures.Selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  const scope = await screen.findByRole('combobox', { name: zh.capabilities.skillScope })
  fireEvent.change(scope, { target: { value: 'auto' } })
  expect(screen.getByRole('checkbox', { name: /notice · 1/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
  await waitFor(() => expect(writes[0]?.body).toMatchObject({ skill_mode: 'auto', skills: [] }))
})

it('uploads a package instead of silently discarding its resources', async () => {
  page(<CapabilitySettings kind="skill" />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.add }))
  fireEvent.change(screen.getByLabelText(zh.capabilities.skillName), {
    target: { value: 'agently-suite' },
  })
  fireEvent.change(screen.getByLabelText(zh.capabilities.description), {
    target: { value: 'Agently guidance' },
  })
  const file = new File(['PK-synthetic'], 'skills.zip', { type: 'application/zip' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('PK-synthetic').buffer,
  })
  fireEvent.change(screen.getByLabelText(zh.capabilities.importFile), { target: { files: [file] } })
  await screen.findByRole('status')
  expect(
    screen.queryByRole('textbox', { name: zh.capabilities.instructions }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.import }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].path).toMatch(/\/skill-packages$/)
  expect(writes[0].body.archive_base64).toBe(btoa('PK-synthetic'))
  expect(writes[0].body).not.toHaveProperty('content')
})
