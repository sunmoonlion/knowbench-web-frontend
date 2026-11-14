import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CapabilitySettings } from '@/features/settings/ui/capabilities-section'
import { CapabilityPanel } from '@/components/workbench/capability-panel'
import { WorkbenchProvider } from '@/lib/workbench/context'
import zh from '@/messages/zh-CN.json'
import fixtures from '@/tests/fixtures/capabilities-v1.samples.json'
import type { Selection, CapabilityCall } from '@/lib/workbench/capabilities'

vi.mock('next/navigation', () => ({
  usePathname: () => '/zh-CN/workbench/chat/22222222-2222-4222-8222-222222222222',
  useSearchParams: () =>
    new URLSearchParams(
      'returnTo=%2Fzh-CN%2Fworkbench%2Fchat%2F22222222-2222-4222-8222-222222222222',
    ),
}))
let catalog: typeof fixtures.Catalog, selection: Selection, calls: { calls: CapabilityCall[] }
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
  selection = structuredClone(fixtures.Selection) as Selection
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
        if (path.endsWith('/cancel')) {
          calls.calls[0].status = 'failed'
          return Response.json(calls.calls[0])
        }
        if (path.endsWith('/actions')) {
          const asset = catalog.assets.find((a) => path.includes(a.id))!
          asset.status = 'disconnected'
          return Response.json(asset)
        }
        if (path.endsWith('/skill-sources/preview'))
          return Response.json({
            repository: 'https://github.com/owner/repo',
            commit: 'a'.repeat(40),
            candidates: [
              {
                path: 'skills/notice',
                name: 'notice',
                description: 'Notice guidance',
                digest: 'b'.repeat(64),
                files: 3,
                has_scripts: true,
                instructions: 'Review recipients before use.',
              },
            ],
          })
        if (path.endsWith('/skill-sources/install'))
          return Response.json(catalog.assets[1], { status: 201 })
        if (path.endsWith('/skills') || path.endsWith('/skill-packages'))
          return Response.json(catalog.assets[1], { status: 201 })
        if (path.endsWith('/capabilities')) {
          const fields = { ...body }
          delete fields.method_context
          selection = { ...selection, ...fields, revision: selection.revision + 1 }
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

it('shows script artifacts as downloads and can stop a running script', async () => {
  const call = calls.calls[0]
  call.detail.execution_kind = 'skill_script'
  call.status = 'dispatching'
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.thisRun }))
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.stopScript }))
  await waitFor(() =>
    expect(writes.some((write) => write.path.endsWith(`/${call.id}/cancel`))).toBe(true),
  )
})

it('returns a script result with a real artifact download URL', async () => {
  const call = calls.calls[0]
  call.detail.execution_kind = 'skill_script'
  call.status = 'succeeded'
  call.detail.result = {
    exit_code: 0,
    stdout: '42',
    stderr: '',
    timed_out: false,
    output_truncated: false,
    artifacts: [
      {
        path: 'answer.txt',
        sha256: 'a'.repeat(64),
        download_url: `/api/workbench/capability-calls/${call.id}/artifacts/0`,
      },
    ],
  }
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.thisRun }))
  expect(await screen.findByRole('link', { name: '下载 answer.txt' })).toHaveAttribute(
    'href',
    `/api/workbench/capability-calls/${call.id}/artifacts/0`,
  )
  expect(screen.getByText('42')).toBeInTheDocument()
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
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.installSkill }))
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.fromFile }))
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
  expect(writes[0].body.tool_requirements).toEqual([
    { url: fixtures.Asset.detail.url, name: 'send' },
  ])
  expect(writes[0].body.dependencies).toBeUndefined()
  expect(writes[0].body.content).toBe('Validate the recipient before sending.')
})

it('shows the account requirement without automatically selecting its tool', async () => {
  selection.tools = []
  selection.available_skills[0].detail.dependency_status![0].status = 'selection_required'
  page(<CapabilityPanel sessionId={fixtures.Selection.session_id} />)
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(zh.capabilities.thisRun) }))
  expect(
    await screen.findByText(zh.capabilities.dependencyStatus.selection_required),
  ).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: /Office mail/ })).not.toBeChecked()
  expect(writes).toHaveLength(0)
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

it('explains unavailable operation scope and prevents new selection while allowing removal', async () => {
  const tool = selection.available_tools[0]
  tool.status = 'operation_unavailable'
  selection.tools = [tool.key]
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(zh.capabilities.thisRun) }))
  expect(await screen.findByText(zh.capabilities.issue.operation_unavailable)).toBeInTheDocument()
  const checkbox = screen.getByRole('checkbox', { name: /Office mail/ })
  expect(checkbox).toBeChecked()
  expect(checkbox).not.toBeDisabled()
  fireEvent.click(checkbox)
  expect(checkbox).not.toBeChecked()
  expect(checkbox).toBeDisabled()
  expect(writes).toHaveLength(0)
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
      method_context: null,
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
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.installSkill }))
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.fromFile }))
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

it('binds installed account assets to the frozen step without changing its requirements', async () => {
  selection.method = {
    task_id: '33333333-3333-4333-8333-333333333333',
    profile_id: 'notice-expert',
    step_id: 'deliver',
    declared_tools: [],
    managed_bindings_supported: true,
    context: 'a'.repeat(64),
    requirements: {
      tools: [{ url: 'https://tools.example.test/mcp', name: 'send' }],
      skills: [{ name: 'notice', version: '1', digest: 'b'.repeat(64) }],
    },
  }
  page(<CapabilityPanel sessionId={fixtures.Selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  expect(await screen.findByText(zh.capabilities.methodBindingHint)).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: zh.capabilities.skillScope })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
  await waitFor(() =>
    expect(writes[0]?.body).toMatchObject({
      method_context: 'a'.repeat(64),
      tools: fixtures.Selection.tools,
      skills: fixtures.Selection.skills,
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})

it('installs from a reviewed repository preview and pins the selected content automatically', async () => {
  page(<CapabilitySettings kind="skill" />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.installSkill }))
  fireEvent.change(screen.getByLabelText(zh.capabilities.repositoryUrl), {
    target: { value: 'https://github.com/owner/repo' },
  })
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.previewSource }))
  expect(await screen.findByRole('radio', { name: /notice/ })).toBeChecked()
  expect(screen.getByText(zh.capabilities.scriptsNotSupported)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: /Office mail/ }))
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.installEnable }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1].body).toMatchObject({
    url: 'https://github.com/owner/repo',
    commit: 'a'.repeat(40),
    path: 'skills/notice',
    digest: 'b'.repeat(64),
    tool_requirements: [{ url: fixtures.Asset.detail.url, name: 'send' }],
  })
  await waitFor(() =>
    expect(screen.queryByLabelText(zh.capabilities.repositoryUrl)).not.toBeInTheDocument(),
  )
})

it('asks for confirmation before uninstalling and removes further use without deleting history', async () => {
  page(<CapabilitySettings kind="skill" />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.uninstall }))
  expect(screen.getByText(zh.capabilities.uninstallWarning)).toBeInTheDocument()
  expect(writes).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.confirmUninstall }))
  await waitFor(() => expect(writes[0]?.body.action).toBe('remove'))
  expect(await screen.findByText(zh.capabilities.uninstalled)).toBeInTheDocument()
})
