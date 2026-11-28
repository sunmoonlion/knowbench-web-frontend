import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CapabilitySettings } from '@/features/settings/ui/capabilities-section'
import { MethodConnectionPreview } from '@/components/workbench/method-connection-preview'
import { PendingConnectorAction } from '@/components/workbench/capability-action-card'
import { CapabilityPanel } from '@/components/workbench/capability-panel'
import { WorkbenchProvider } from '@/lib/workbench/context'
import zh from '@/messages/zh-CN.json'
import fixtures from '@/tests/fixtures/capabilities-v1.samples.json'
import type { Selection, CapabilityCall } from '@/lib/workbench/capabilities'
import { callSchema, selectionSchema } from '@/lib/workbench/capabilities'

vi.mock('next/navigation', () => ({
  usePathname: () => '/zh-CN/workbench/chat/22222222-2222-4222-8222-222222222222',
  useSearchParams: () =>
    new URLSearchParams(
      'returnTo=%2Fzh-CN%2Fworkbench%2Fchat%2F22222222-2222-4222-8222-222222222222',
    ),
}))
let modelItems = structuredClone(fixtures.FormalMethodCatalogResponse.items)
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
  modelItems = structuredClone(fixtures.FormalMethodCatalogResponse.items)
  catalog = structuredClone(fixtures.Catalog)
  selection = selectionSchema.parse(structuredClone(fixtures.Selection))
  calls = { calls: [callSchema.parse(structuredClone(fixtures.Call))] }
  writes.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input)
      if (init.method && init.method !== 'GET') {
        const body = JSON.parse(String(init.body))
        writes.push({ path, body, headers: init.headers })
        if (path.endsWith('/oauth/start'))
          return Response.json({ authorization_url: 'http://accounts.example.test/approve' })
        if (path.endsWith('/revoke-method')) {
          selection = {
            ...selection,
            revision: selection.revision + 1,
            method: { ...selection.method!, permission_status: 'revoked' },
            issues: [{ ref: 'method', code: 'method_permission_revoked' }],
          }
          return Response.json(selection)
        }
        if (path.endsWith('/revoke-read')) {
          calls.calls[0].detail.approval!.revoked = true
          return Response.json(calls.calls[0])
        }
        if (path.endsWith('/decision')) {
          if (body.remember_read) calls.calls[0].detail.approval!.granted = true
          calls.calls[0].status = 'succeeded'
          return Response.json(calls.calls[0])
        }
        if (path.endsWith('/cancel')) {
          if (
            ['formal_script', 'registry_script'].includes(
              calls.calls[0].detail.execution_kind ?? '',
            )
          ) {
            calls.calls[0].detail.result = { stop_requested: true }
          } else {
            calls.calls[0].status = 'failed'
          }
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
      if (path.endsWith('/instructions')) return Response.json('Stored instruction text')
      if (path.endsWith('/formal-methods?caller=model')) return Response.json({ items: modelItems })
      if (path.endsWith('/formal-methods')) return Response.json({ items: [] })
      if (path.endsWith('/formal-method-calls')) return Response.json({ calls: [] })
      if (path.includes('/capability-calls?call_id=')) {
        const id = new URL(path, 'http://localhost').searchParams.get('call_id')
        return Response.json({ calls: calls.calls.filter((call) => call.id === id) })
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

it('displays and approves a host method call using its exact existing approval', async () => {
  calls.calls[0] = callSchema.parse(structuredClone(fixtures.HostCall))
  const detail = calls.calls[0].detail
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.thisRun }))
  expect(await screen.findByText(zh.capabilities.formalMethodCall)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.allowOnce }))
  await waitFor(() => expect(writes.some((w) => w.path.endsWith('/decision'))).toBe(true))
  expect(writes.find((w) => w.path.endsWith('/decision'))!.body).toEqual({
    decision: 'accept',
    token: detail.approval_token,
    subject_digest: calls.calls[0].digest,
  })
})

it.each([true, false])(
  'requires matching material consent before approving a read (current %s)',
  async (current) => {
    const call = callSchema.parse(fixtures.OrdinaryMaterialRead)
    calls = { calls: [call] }
    const path = `/api/workbench/capability-calls/${call.id}/knowbase-read`
    const sha256 = fixtures.OrdinaryMaterialRead.detail.material_sha256
    const expires_at = '2030-05-01T00:00:00Z'
    const normal = globalThis.fetch
    const requests: RequestInit[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (!url.endsWith(path)) return normal(url, init)
      requests.push(init)
      return Response.json(
        init.method === 'POST'
          ? { grant_id: call.id }
          : {
              subject_digest: call.digest,
              material_sha256: current ? sha256 : 'b'.repeat(64),
              expires_at,
            },
      )
    })
    page(<PendingConnectorAction sessionId={selection.session_id} callId={call.id} />)
    const allow = await screen.findByRole('button', { name: zh.capabilities.allowMaterialRead })
    expect(screen.getByText('SHA-256 ' + sha256)).toBeVisible()
    expect(requests).toHaveLength(0)
    fireEvent.click(allow)
    if (current) {
      await waitFor(() => expect(writes.some((w) => w.path.endsWith('/decision'))).toBe(true))
      expect(JSON.parse(String(requests[1].body))).toEqual({
        sha256,
        expires_at,
        subject_digest: call.digest,
      })
    } else {
      await waitFor(() => expect(requests).toHaveLength(1))
      await waitFor(() => expect(allow).toBeEnabled())
      expect(writes).toHaveLength(0)
    }
  },
)

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

it.each(['formal_script', 'registry_script'] as const)(
  'shows the quote and stops a running %s',
  async (kind) => {
    const call = calls.calls[0]
    const detail: Record<string, unknown> = { ...call.detail }
    for (const key of ['selection_revision', 'runtime', 'method']) delete detail[key]
    calls.calls[0] = callSchema.parse({
      ...call,
      status: 'dispatching',
      connection_id: null,
      detail: {
        ...detail,
        source_asset_id: kind === 'registry_script' ? null : call.id,
        execution_kind: kind,
        ...(kind === 'registry_script'
          ? {
              source: {
                source_id: call.id,
                version: 1,
                digest: 'a'.repeat(64),
                kind: 'script',
                name: 'fixture',
              },
              approval_digest: 'b'.repeat(64),
            }
          : {}),
        connection_id: null,
        script_quote: {
          environment: 'test-pool',
          revision: 1,
          currency: 'CNY',
          per_container_second: '0.01',
          maximum: '0.91',
          maximum_seconds: 91,
          tariff_digest: 'a'.repeat(64),
          evidence_reference: 'test-only',
          evidence_digest: 'sha256:' + 'b'.repeat(64),
        },
      },
    })
    page(<CapabilityPanel sessionId={selection.session_id} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.thisRun }))
    expect(
      await screen.findByText(/test-pool.*每秒 0.01 CNY.*最多预留 0.91 CNY.*失败或取消/),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: zh.capabilities.stopScript }))
    await waitFor(() =>
      expect(writes.some((w) => w.path.endsWith(`/${call.id}/cancel`))).toBe(true),
    )
    expect(await screen.findByText(zh.capabilities.scriptStopping)).toBeVisible()
    expect(screen.getByRole('button', { name: zh.capabilities.stopScript })).toBeDisabled()
    expect(screen.queryByText(/stop_requested/)).toBeNull()
    if (kind === 'formal_script')
      expect(screen.getByText(zh.capabilities.formalMethodCall)).toBeVisible()
  },
)

it('shows the registered instruction, destination and maximum before approval', async () => {
  const call = calls.calls[0]
  const detail: Record<string, unknown> = { ...call.detail }
  for (const key of ['selection_revision', 'runtime', 'method']) delete detail[key]
  calls.calls[0] = callSchema.parse({
    ...call,
    connection_id: null,
    source_asset_id: null,
    detail: {
      ...detail,
      source_asset_id: null,
      connection_id: null,
      execution_kind: 'formal_instruction',
      instruction_quote: {
        provider: 'example',
        model: 'test-model',
        currency: 'CNY',
        maximum: '0.05',
        destination: 'https://provider.example/responses',
      },
      registered_source: {
        source: call.id,
        version: '1',
        kind: 'registered_instruction',
        entry: 'review.md',
        asset_id: null,
        asset_revision: null,
        digest: 'sha256:' + 'a'.repeat(64),
        license_basis: 'owner',
      },
    },
  })
  page(<PendingConnectorAction sessionId={selection.session_id} callId={call.id} />)
  expect(await screen.findByText(/test-model.*provider.example\/responses.*CNY 0.05/)).toBeVisible()
  expect(screen.getByText(/review.md.*v1.*sha256/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.allowOnce }))
  await waitFor(() => expect(writes.some((w) => w.path.endsWith('/decision'))).toBe(true))
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

it('fetches installed instructions only when their owner opens the disclosure', async () => {
  page(<CapabilitySettings kind="skill" />)
  const summary = await screen.findByText(zh.capabilities.instructions)
  const path = `/api/workbench/capabilities/skills/${catalog.assets[1].id}/instructions`
  expect(fetch).not.toHaveBeenCalledWith(path, expect.anything())
  fireEvent.click(summary)
  expect(await screen.findByText('Stored instruction text')).toBeVisible()
  expect(fetch).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'GET' }))
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
      formal_methods: [],
      delegations: {},
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
    permission_status: 'active',
    delegation_options: [],
    context: 'a'.repeat(64),
    access_requirements: [
      {
        requirement_id: 'deliver-notice',
        capability_ref: 'synthetic-mail',
        version: '1',
        operations: ['send'],
        resources: [
          { resource_kind: 'connector', resource_role: 'recipient', values: ['test@example.test'] },
        ],
        data_transfer: {
          destination: 'https://tools.example.test/mcp',
          argument_fields: ['to'],
          purpose: 'Deliver the confirmed notice',
        },
        required_when: 'always',
        on_unavailable: 'pause',
      },
    ],
    requirements: {
      tools: [
        { url: 'https://tools.example.test/mcp', name: 'send', requirement_id: 'deliver-notice' },
      ],
      skills: [{ name: 'notice', version: '1', digest: 'b'.repeat(64) }],
    },
  }
  page(<CapabilityPanel sessionId={fixtures.Selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  expect(await screen.findByText(zh.capabilities.methodBindingHint)).toBeInTheDocument()
  expect(screen.getByText(/test@example.test/)).toBeInTheDocument()
  expect(screen.getByText(/Deliver the confirmed notice/)).toBeInTheDocument()
  expect(screen.getByText(zh.capabilities.methodPermissionConfirmHint)).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: zh.capabilities.skillScope })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.confirmMethodPermissions }))
  await waitFor(() =>
    expect(writes[0]?.body).toMatchObject({
      method_context: 'a'.repeat(64),
      tools: fixtures.Selection.tools,
      skills: fixtures.Selection.skills,
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})

it('can revoke method permissions while the step is running without clearing selected assets', async () => {
  selection.editable = false
  selection.method = {
    task_id: '33333333-3333-4333-8333-333333333333',
    profile_id: 'notice-expert',
    step_id: 'deliver',
    declared_tools: [],
    managed_bindings_supported: true,
    permission_status: 'active',
    delegation_options: [],
    context: 'a'.repeat(64),
    access_requirements: [],
  }
  const selectedTools = [...selection.tools]
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.methodRevoke }))
  await waitFor(() => expect(writes[0]?.path).toMatch(/\/capabilities\/revoke-method$/))
  expect(writes[0].body).toEqual({
    revision: fixtures.Selection.revision,
    method_context: 'a'.repeat(64),
  })
  expect(
    await screen.findByText(zh.capabilities.issue.method_permission_revoked),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: zh.capabilities.methodRevoke }),
  ).not.toBeInTheDocument()
  expect(selection.tools).toEqual(selectedTools)
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

it('never projects raw formal method results through a generic operation card', async () => {
  calls.calls = [
    callSchema.parse({
      ...fixtures.FormalCall,
      status: 'succeeded',
      detail: { ...fixtures.FormalCall.detail, result: { unvalidated: 'RAW-METHOD-RESULT' } },
    }),
  ]
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByText(zh.capabilities.formalMethodCall)
  expect(screen.queryByText(/RAW-METHOD-RESULT/)).not.toBeInTheDocument()
})

it('labels a model incubation probe distinctly and submits only its existing approval identity', async () => {
  calls.calls[0] = callSchema.parse(structuredClone(fixtures.FormalProbeCall))
  const call = calls.calls[0]
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.thisRun }))
  expect(await screen.findByText(zh.capabilities.formalModelProbeCall)).toBeInTheDocument()
  expect(screen.queryByText(zh.capabilities.formalMethodCall)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: zh.capabilities.stopScript })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.allowOnce }))
  await waitFor(() => expect(writes.some((w) => w.path.endsWith('/decision'))).toBe(true))
  expect(writes.find((w) => w.path.endsWith('/decision'))!.body).toEqual({
    decision: 'accept',
    token: call.detail.approval_token,
    subject_digest: call.digest,
  })
})

it('saves explicitly selected model methods by exact reference without approving or invoking them', async () => {
  const item = modelItems.find((item) => item.available)!
  page(<CapabilityPanel sessionId={selection.session_id} enableFormalInvocations />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  const checkbox = await screen.findByRole('checkbox', {
    name: `${item.title} · v${item.reference.version}`,
  })
  expect(checkbox).not.toBeChecked()
  expect(screen.getByText(zh.formalMethodSelection.hint)).toBeInTheDocument()
  fireEvent.click(checkbox)
  expect(writes).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].path).toContain('/capabilities')
  expect(writes[0].body).toMatchObject({
    revision: selection.revision - 1,
    formal_methods: [item.reference],
  })
  expect(
    writes.some((w) => w.path.endsWith('/decision') || w.path.endsWith('/formal-method-calls')),
  ).toBe(false)
})
it('keeps unavailable selected versions removable and never silently replaces them', async () => {
  const item = modelItems.find((item) => item.available)!
  const stale = { ...item.reference, version: item.reference.version + 10 }
  selection.formal_methods = [stale]
  page(<CapabilityPanel sessionId={selection.session_id} enableFormalInvocations />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  expect(await screen.findByText(zh.formalMethodSelection.missing)).toBeInTheDocument()
  expect(
    await screen.findByRole('checkbox', { name: `${item.title} · v${item.reference.version}` }),
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: zh.formalMethodSelection.remove }))
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
  await waitFor(() => expect(writes[0]?.body.formal_methods).toEqual([]))
})
it('does not allow unavailable model methods or edits while the selection is locked', async () => {
  selection.editable = false
  page(<CapabilityPanel sessionId={selection.session_id} enableFormalInvocations />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  for (const item of modelItems) {
    expect(
      await screen.findByRole('checkbox', { name: `${item.title} · v${item.reference.version}` }),
    ).toBeDisabled()
  }
  expect(writes).toHaveLength(0)
})
it('does not show model method selection in an expert-only capability panel', async () => {
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByRole('button', { name: zh.capabilities.saveSelection })
  expect(screen.queryByText(zh.formalMethodSelection.title)).not.toBeInTheDocument()
})

const delegationAuthority = {
  record_id: 'reviewed-mail-owner',
  revision: 1,
  digest: 'sha256:' + 'c'.repeat(64),
}
function delegationStep() {
  const option = {
    tool_key: selection.tools[0],
    authority: { ...delegationAuthority },
    issuer: 'Mail resource owner',
    expires_at: '2099-01-01T00:00:00Z',
    binding: {
      kind: 'accepted_plan' as const,
      parent_method_id: 'accepted-parent-plan',
      parent_snapshot_digest: 'sha256:' + 'd'.repeat(64),
      child_method_id: 'send-confirmed-notice',
      child_method_version: 'reviewed-v1',
    },
  }
  selection.method = {
    task_id: '33333333-3333-4333-8333-333333333333',
    profile_id: 'notice-expert',
    step_id: 'deliver',
    declared_tools: [],
    managed_bindings_supported: true,
    permission_status: 'unconfirmed',
    context: 'a'.repeat(64),
    access_requirements: [],
    delegation_options: [option],
  }
  return option
}
it('keeps resource delegation unselected by default and preserves exact direct grants', async () => {
  delegationStep()
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByText(zh.resourceDelegation.title)
  expect(screen.getByText(zh.resourceDelegation.hint)).toBeInTheDocument()
  const choice = screen.getByRole('combobox', { name: /为 Office mail · send 选择依据/ })
  expect(choice).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
  await waitFor(() => expect(writes[0]?.body.delegations).toEqual({}))
})
it('saves only the exact resource authority reference after an explicit basis choice', async () => {
  const option = delegationStep()
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  const choice = await screen.findByRole('combobox', { name: /为 Office mail · send 选择依据/ })
  const selectOption = screen.getByRole<HTMLOptionElement>('option', {
    name: /Mail resource owner/,
  })
  fireEvent.change(choice, { target: { value: selectOption.value } })
  expect(writes).toHaveLength(0)
  expect(screen.getByText(/accepted-parent-plan → send-confirmed-notice/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].body.delegations).toEqual({ [option.tool_key]: delegationAuthority })
  expect(writes[0].body).not.toHaveProperty('delegable')
  expect(writes[0].body).not.toHaveProperty('parent_call_id')
  expect(JSON.stringify(writes[0].body.delegations)).not.toContain('binding')
})
it.each(['changed', 'removed', 'expired'] as const)(
  'requires renewed choice when a delegation option is %s during polling',
  async (change) => {
    const option = delegationStep()
    page(<CapabilityPanel sessionId={selection.session_id} />)
    fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
    const choice = await screen.findByRole('combobox', { name: /为 Office mail · send 选择依据/ })
    fireEvent.change(choice, {
      target: {
        value: screen.getByRole<HTMLOptionElement>('option', { name: /Mail resource owner/ }).value,
      },
    })
    selection.method!.delegation_options =
      change === 'removed'
        ? []
        : [
            {
              ...option,
              ...(change === 'changed'
                ? {
                    authority: {
                      ...option.authority,
                      revision: 2,
                      digest: 'sha256:' + 'e'.repeat(64),
                    },
                  }
                : { expires_at: '2020-01-01T00:00:00Z' }),
            },
          ]
    fireEvent.click(screen.getByRole('button', { name: zh.capabilities.reload }))
    await screen.findByText(zh.capabilities.delegationReviewRequired)
    expect(screen.getByRole('button', { name: zh.capabilities.saveSelection })).toBeDisabled()
    expect(writes).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: zh.resourceDelegation.clear }))
    fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
    await waitFor(() => expect(writes[0]?.body.delegations).toEqual({}))
  },
)
it('does not expose delegation choices in an ordinary conversation', async () => {
  page(<CapabilityPanel sessionId={selection.session_id} enableFormalInvocations />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByRole('button', { name: zh.capabilities.saveSelection })
  expect(screen.queryByText(zh.resourceDelegation.title)).not.toBeInTheDocument()
})
it('does not permit delegation changes during an executing method step', async () => {
  delegationStep()
  selection.editable = false
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  expect(
    await screen.findByRole('combobox', { name: /为 Office mail · send 选择依据/ }),
  ).toBeDisabled()
  expect(writes).toHaveLength(0)
})

it('rechecks delegation expiry at submit even without a new server snapshot', async () => {
  delegationStep()
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  const choice = await screen.findByRole('combobox', { name: /为 Office mail · send 选择依据/ })
  fireEvent.change(choice, {
    target: {
      value: screen.getByRole<HTMLOptionElement>('option', { name: /Mail resource owner/ }).value,
    },
  })
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2100-01-01T00:00:00Z'))
  try {
    fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
    await screen.findByText(zh.capabilities.delegationReviewRequired)
    expect(writes).toHaveLength(0)
  } finally {
    now.mockRestore()
  }
})

it('submits the exact account revision and rejects an insecure authorization redirect', async () => {
  const source = catalog.assets[0]
  Object.assign(source.detail, {
    auth: 'oauth',
    oauth: {
      protocol: 'a2a',
      provider_id: 'agent',
      issuer: 'https://issuer.example',
      account_id: 'account-a',
      scopes: ['read'],
    },
  })
  Object.assign(catalog.services[0], {
    provider_id: 'agent',
    protocol: 'a2a',
    authentication: ['oauth'],
  })
  page(<CapabilitySettings kind="connection" />)
  expect(await screen.findByText(/已验证账号 account-a/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.add }))
  expect(screen.queryByLabelText(zh.capabilities.token)).not.toBeInTheDocument()
  expect(screen.getByText(zh.capabilities.oauthHint)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.reauthorizeAccount }))
  await waitFor(() =>
    expect(writes[0]?.body).toEqual({
      provider_id: 'agent',
      name: source.name,
      locale: 'zh-CN',
      connection_id: source.id,
      revision: source.revision,
      return_to: '/zh-CN/workbench/chat/22222222-2222-4222-8222-222222222222',
    }),
  )
  expect(await screen.findByRole('alert')).toBeInTheDocument()
})

it('shows required, conditional and unresolved method connections before selection', () => {
  page(
    <MethodConnectionPreview
      preview={{
        complete: false,
        services: [
          { url: 'https://mail.example', capability_ref: 'mail', version: '1', required: true },
          { url: 'https://chat.example', capability_ref: 'chat', version: '1', required: false },
        ],
      }}
    />,
  )
  expect(screen.getByText(/必需 · mail/)).toBeInTheDocument()
  expect(screen.getByText(/按所选步骤和候选确定 · chat/)).toBeInTheDocument()
  expect(screen.getByText(zh.capabilities.unresolvedConnections)).toBeInTheDocument()
})

it('shows a bounded read choice, records explicit consent and can revoke it', async () => {
  const call = calls.calls[0]
  call.detail.approval = {
    effect: 'read',
    operation: 'read_record',
    destination: 'https://records.example.test',
    resources: [{ resource_kind: 'connector', resource_role: 'record', values: ['a', 'b'] }],
    attachments: [],
    arguments_digest: 'a'.repeat(64),
    read_until: '2099-01-01T00:00:00Z',
    granted: false,
    revoked: false,
    origin: null,
    verified_zero_cost: false,
  }
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.thisRun }))
  expect(await screen.findByText('record · a, b')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.allowReadScope }))
  await waitFor(() =>
    expect(writes.find((w) => w.path.endsWith('/decision'))?.body).toEqual({
      token: call.detail.approval_token,
      subject_digest: call.digest,
      decision: 'accept',
      remember_read: true,
    }),
  )
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.revokeRead }))
  expect(await screen.findByText(zh.capabilities.readRevoked)).toBeInTheDocument()
})

it('shows the immutable attachment and recipient for a once-only outbound action', async () => {
  calls.calls[0].detail.approval = {
    effect: 'send',
    operation: 'send',
    destination: 'https://mail.example.test',
    resources: [
      { resource_kind: 'connector', resource_role: 'to', values: ['reader@example.test'] },
    ],
    attachments: [{ name: 'report.pdf', size: 12, sha256: 'c'.repeat(64) }],
    arguments_digest: 'a'.repeat(64),
    read_until: null,
    granted: false,
    revoked: false,
    origin: null,
    verified_zero_cost: false,
  }
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.thisRun }))
  expect(await screen.findByText(/report.pdf · 12 B · SHA-256/)).toBeInTheDocument()
  expect(screen.getByText('to · reader@example.test')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: zh.capabilities.allowReadScope }),
  ).not.toBeInTheDocument()
})

it('loads the named receipt from a work step and never substitutes another pending approval', async () => {
  page(<PendingConnectorAction sessionId={selection.session_id} callId={selection.session_id} />)
  expect(await screen.findByText(zh.capabilities.missingApproval)).toBeVisible()
  expect(screen.queryByRole('button', { name: zh.capabilities.allowOnce })).not.toBeInTheDocument()
})

it('discards purpose edits made while the previous revision is being saved', async () => {
  const gate = Promise.withResolvers<void>()
  const normal = globalThis.fetch
  let pending = false
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    if (input.endsWith('/capabilities') && init.method === 'PUT') {
      pending = true
      await gate.promise
    }
    return normal(input, init)
  })
  page(<CapabilityPanel sessionId={selection.session_id} />)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  const box = await screen.findByLabelText(zh.capabilities.purpose)
  fireEvent.change(box, { target: { value: '第一版用途' } })
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.saveSelection }))
  await waitFor(() => expect(pending).toBe(true))
  expect(box).toBeDisabled()
  gate.resolve()
  await waitFor(() =>
    expect(screen.getByLabelText(zh.capabilities.purpose)).toHaveValue('第一版用途'),
  )
  expect(writes.map((w) => w.body.purpose)).toEqual(['第一版用途'])
})

it('retains the typed skill and permits manual recovery after an unreadable upload', async () => {
  page(<CapabilitySettings kind="skill" />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.installSkill }))
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.fromFile }))
  const content = screen.getByRole('textbox', { name: zh.capabilities.instructions })
  fireEvent.change(content, { target: { value: '已审核指令' } })
  fireEvent.change(screen.getByLabelText(zh.capabilities.importFile), {
    target: {
      files: [new File(['invalid'], 'unsupported.txt')],
    },
  })
  await screen.findByRole('alert')
  expect(content).toHaveValue('已审核指令')
  fireEvent.change(content, { target: { value: '重新手填的指令' } })
  fireEvent.change(screen.getByLabelText(zh.capabilities.skillName), {
    target: { value: 'valid-skill' },
  })
  fireEvent.change(screen.getByLabelText(zh.capabilities.description), {
    target: { value: 'purpose' },
  })
  expect(screen.getByRole('button', { name: zh.capabilities.import })).toBeEnabled()
})
it('resets dependency selection from one repository to the next sole candidate', async () => {
  page(<CapabilitySettings kind="skill" />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.installSkill }))
  const normal = globalThis.fetch
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const response = await normal(path, init)
    if (!path.endsWith('/preview') || !String(init.body).includes('/second')) return response
    const data = await response.json()
    return Response.json({
      ...data,
      repository: 'https://github.com/owner/second',
      commit: 'f'.repeat(40),
      candidates: [
        {
          ...data.candidates[0],
          name: 'other-skill',
          path: 'second-skill',
          digest: 'e'.repeat(64),
        },
      ],
    })
  })
  const url = screen.getByLabelText(zh.capabilities.repositoryUrl)
  fireEvent.change(url, { target: { value: 'https://github.com/owner/first' } })
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.previewSource }))
  fireEvent.click(await screen.findByRole('checkbox', { name: /Office mail/ }))
  fireEvent.change(url, { target: { value: 'https://github.com/owner/second' } })
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.previewSource }))
  expect(await screen.findByRole('radio', { name: /other-skill/ })).toBeChecked()
  expect(await screen.findByRole('checkbox', { name: /Office mail/ })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.installEnable }))
  await waitFor(() => expect(writes.at(-1)?.body.url).toBe('https://github.com/owner/second'))
  await waitFor(() => expect(writes.at(-1)?.body.tool_requirements).toHaveLength(0))
})

it('clears both credentials when switching to another service', async () => {
  const second = { ...catalog.services[0], url: 'https://second.example.test/mcp' }
  catalog.services.push(second)
  page(<CapabilitySettings kind="connection" />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.add }))
  const account = screen.getByLabelText(zh.capabilities.account)
  const token = screen.getByLabelText(zh.capabilities.token)
  fireEvent.change(account, { target: { value: 'first account' } })
  fireEvent.change(token, { target: { value: 'fixture' } })
  fireEvent.change(screen.getByLabelText(zh.capabilities.service), {
    target: { value: second.url },
  })
  expect(account).toHaveValue('')
  expect(token).toHaveValue('')
  expect(writes).toHaveLength(0)
})

it('requires a new uninstall confirmation when the asset revision changes', async () => {
  page(<CapabilitySettings kind="skill" />)
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.uninstall }))
  expect(screen.getByRole('button', { name: zh.capabilities.confirmUninstall })).toBeVisible()
  const next = structuredClone(catalog)
  next.assets.forEach((asset) => {
    asset.revision += 1
  })
  act(() => {
    clients[0].setQueryData(['capability-catalog'], next)
  })
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: zh.capabilities.confirmUninstall })).toBeNull(),
  )
  expect(writes).toHaveLength(0)
})
