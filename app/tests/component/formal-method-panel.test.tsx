import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CapabilityPanel } from '@/components/workbench/capability-panel'
import { WorkbenchProvider } from '@/lib/workbench/context'
import {
  formalMethodCatalogItemSchema,
  formalMethodInvocationSchema,
  formalMethodInvocation,
  invokeFormalMethod,
} from '@/lib/workbench/formal-methods'
import { callSchema } from '@/lib/workbench/capabilities'
import zh from '@/messages/zh-CN.json'
import samples from '@/tests/fixtures/capabilities-v1.samples.json'

vi.mock('next/navigation', () => ({
  usePathname: () => '/zh-CN/workbench/chat/' + samples.Selection.session_id,
}))
const SESSION = samples.Selection.session_id
const t = zh.formalMethods
const csrf = 'csrf-fixture'
const item = formalMethodCatalogItemSchema.parse({
  reference: samples.FormalMethodInvocation.reference,
  title: '核对输入',
  purpose: '只核对提供的文字',
  inputs: {
    text: {
      description: '要核对的文字',
      schema: { type: 'string' },
      required: true,
      meaning: {},
      on_missing: 'fail',
    },
  },
  outputs: {
    summary: {
      description: '核对结论',
      schema: { type: 'string' },
      required: true,
      meaning: {},
      on_missing: 'fail',
    },
  },
  access_requirements: [
    {
      requirement_id: 'check',
      capability_ref: 'fixture.check',
      version: '1',
      operations: ['read'],
      resources: [{ resource_kind: 'connector', resource_role: 'source', values: ['self'] }],
      data_transfer: {
        destination: 'fixture.check',
        argument_fields: ['text'],
        purpose: '核对输入',
      },
      required_when: 'always',
      on_unavailable: 'pause',
    },
  ],
  uncovered: [{ scenario: '复杂文件', reason: '未验证', scope: '仅普通文字' }],
  available: true,
  issue: null,
})
let items = [item]
let calls: ReturnType<typeof formalMethodInvocationSchema.parse>[] = []
let outcome: 'succeeded' | 'invalid' | 'unknown' = 'succeeded'
const fetcher = vi.fn()
let posts: { url: string; body: Record<string, unknown>; headers: HeadersInit | undefined }[]
const clients: QueryClient[] = []
function page(enableFormalInvocations = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={zh} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken={csrf} locale="zh-CN">
          <CapabilityPanel sessionId={SESSION} enableFormalInvocations={enableFormalInvocations} />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}
beforeEach(() => {
  items = [structuredClone(item)]
  calls = []
  posts = []
  outcome = 'succeeded'
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (init.method && init.method !== 'GET') {
      const body = JSON.parse(String(init.body))
      posts.push({ url, body, headers: init.headers })
      if (url.endsWith('/formal-method-calls')) {
        const prior = calls.find((c) => c.request_id === body.request_id)
        if (prior) return Response.json(prior)
        const call = formalMethodInvocationSchema.parse({
          ...samples.FormalMethodInvocation,
          title: item.title,
          request_id: body.request_id,
          reference: body.reference,
        })
        call.call.detail.arguments = body.values
        calls = [call, ...calls]
        return Response.json(call)
      }
      if (url.endsWith('/decision')) {
        const record = calls.find((c) => url.includes(c.call.id))!
        record.call.status =
          body.decision === 'decline' ? 'declined' : outcome === 'unknown' ? 'unknown' : 'succeeded'
        record.status =
          body.decision === 'decline' ? 'declined' : outcome === 'invalid' ? 'failed' : outcome
        record.outputs = record.status === 'succeeded' ? { summary: 'verified output' } : null
        record.call.detail.result = { raw_private_result: 'not typed output' }
        record.detail = outcome === 'invalid' ? 'Output schema did not match' : 'Call settled'
        record.call.updated_at = '2099-01-01T00:00:00Z'
        return Response.json(record.call)
      }
      throw new Error('Unexpected mutation ' + url)
    }
    if (url.endsWith('/formal-methods?caller=model')) return Response.json({ items: [] })
    if (url.endsWith('/formal-methods')) return Response.json({ items })
    if (url.endsWith('/formal-method-calls')) return Response.json({ calls })
    if (url.includes('/formal-method-calls/')) {
      const found = calls.find((c) => url.endsWith(c.request_id))
      return found
        ? Response.json(found)
        : Response.json({ code: 'not_found', message: 'Not found' }, { status: 404 })
    }
    if (url.endsWith('/capabilities')) return Response.json(samples.Selection)
    if (url.endsWith('/capability-calls')) return Response.json({ calls: calls.map((c) => c.call) })
    throw new Error('Unexpected request ' + url)
  })
})
afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.unstubAllGlobals()
})
async function choose() {
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByRole('option', { name: '核对输入 · v1' })
  fireEvent.change(screen.getByLabelText(t.choose), {
    target: { value: `${item.reference.method_id}:1:${item.reference.digest}` },
  })
  fireEvent.change(screen.getByLabelText(t.values), { target: { value: '{"text":"owned input"}' } })
}
it.each(['accept', 'decline'] as const)(
  'selects an exact owned version and answers its actual operation: %s',
  async (decision) => {
    page()
    await choose()
    expect(screen.getByText('复杂文件 · 未验证 · 仅普通文字')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.invoke }))
    const approval = await screen.findByRole('button', {
      name: decision === 'accept' ? zh.capabilities.allowOnce : zh.capabilities.decline,
    })
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({
      request_id: expect.any(String),
      reference: item.reference,
      values: { text: 'owned input' },
    })
    expect(new Headers(posts[0].headers).get('X-CSRF-Token')).toBe(csrf)
    expect(screen.queryByText(t.validatedOutputs)).not.toBeInTheDocument()
    fireEvent.click(approval)
    if (decision === 'accept') await screen.findByText(t.validatedOutputs)
    else await screen.findByRole('region', { name: `${item.title} · ${t.status.declined}` })
    expect(posts[1].body).toEqual({
      decision,
      token: samples.FormalCall.detail.approval_token,
      subject_digest: samples.FormalCall.digest,
    })
    if (decision === 'accept') expect(screen.getByText(/verified output/)).toBeInTheDocument()
    else expect(screen.queryByText(t.validatedOutputs)).not.toBeInTheDocument()
    expect(screen.queryByText(/raw_private_result/)).not.toBeInTheDocument()
    expect(posts.some((p) => p.url.endsWith('/capabilities'))).toBe(false)
  },
)
it('restores method history using GET and does not claim method success from raw child success', async () => {
  const record = structuredClone(samples.FormalMethodInvocation)
  calls = [
    formalMethodInvocationSchema.parse({
      ...record,
      status: 'failed',
      title: item.title,
      detail: 'Output schema did not match',
      call: {
        ...record.call,
        status: 'succeeded',
        detail: { ...record.call.detail, result: { raw_private_result: 'do not project' } },
      },
    }),
  ]
  page()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  const section = await screen.findByRole('region', { name: `${item.title} · ${t.status.failed}` })
  expect(within(section).getByText('Output schema did not match')).toBeInTheDocument()
  expect(screen.queryByText(t.validatedOutputs)).not.toBeInTheDocument()
  expect(screen.queryByText(/raw_private_result/)).not.toBeInTheDocument()
  expect(posts).toHaveLength(0)
})
it('retains the same request after network failure and panel collapse; refresh never POSTs', async () => {
  const base = fetcher.getMockImplementation()!
  const submitted: string[] = []
  fetcher.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/formal-method-calls') && init.method === 'POST') {
      submitted.push(String(init.body))
      if (submitted.length === 1) throw new TypeError('network lost')
    }
    return base(url, init)
  })
  page()
  await choose()
  fireEvent.click(screen.getByRole('button', { name: t.invoke }))
  await screen.findByRole('button', { name: t.retrySame })
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  fireEvent.click(screen.getByRole('button', { name: t.refresh }))
  await waitFor(() => expect(screen.getByRole('button', { name: t.check })).not.toBeDisabled())
  expect(submitted).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: t.retrySame }))
  await screen.findByRole('button', { name: zh.capabilities.allowOnce })
  expect(submitted).toHaveLength(2)
  expect(submitted[1]).toBe(submitted[0])
})
it('does not invoke unavailable versions, malformed JSON or missing required inputs', async () => {
  items[0].available = false
  items[0].issue = 'source_revision_changed'
  page()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByRole('option', { name: /核对输入/ })
  fireEvent.change(screen.getByLabelText(t.choose), {
    target: { value: `${item.reference.method_id}:1:${item.reference.digest}` },
  })
  expect(screen.getByRole('button', { name: t.invoke })).toBeDisabled()
  items[0].available = true
  items[0].issue = null
  fireEvent.click(screen.getByRole('button', { name: t.refresh }))
  await waitFor(() => expect(screen.getByRole('button', { name: t.invoke })).not.toBeDisabled())
  for (const value of ['[]', '{}', '{bad']) {
    fireEvent.change(screen.getByLabelText(t.values), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: t.invoke }))
    expect(screen.getByText(t.invalid)).toBeInTheDocument()
  }
  items = []
  fireEvent.click(screen.getByRole('button', { name: t.refresh }))
  await screen.findByText(t.selectionChanged)
  expect(screen.getByRole('button', { name: t.invoke })).toBeDisabled()
  expect(posts).toHaveLength(0)
})
it('keeps unknown outcomes visible and never replays them when refreshed', async () => {
  outcome = 'unknown'
  page()
  await choose()
  fireEvent.click(screen.getByRole('button', { name: t.invoke }))
  fireEvent.click(await screen.findByRole('button', { name: zh.capabilities.allowOnce }))
  await screen.findByRole('region', { name: `${item.title} · ${t.status.unknown}` })
  fireEvent.click(screen.getByRole('button', { name: t.refresh }))
  await waitFor(() => expect(screen.getByRole('button', { name: t.check })).not.toBeDisabled())
  expect(posts).toHaveLength(2)
  expect(screen.queryByText(t.validatedOutputs)).not.toBeInTheDocument()
})
it('does not enable the new entry on an ordinary expert capability panel', async () => {
  page(false)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByText(zh.capabilities.selectionHint)
  expect(screen.queryByText(t.title)).not.toBeInTheDocument()
  expect(fetcher.mock.calls.some(([url]) => url.includes('/formal-method'))).toBe(false)
})
it('rejects another session or reference and rejects model authority fields on formal calls', async () => {
  const command = samples.FormalMethodCallRequest
  const base = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (url: string, init: RequestInit = {}) =>
    url.endsWith('/formal-method-calls') && init.method === 'POST'
      ? Response.json({
          ...samples.FormalMethodInvocation,
          reference: { ...command.reference, version: 2 },
        })
      : base(url, init),
  )
  await expect(invokeFormalMethod(SESSION, command, csrf)).rejects.toThrow()
  fetcher.mockImplementation(async () =>
    Response.json({
      ...samples.FormalMethodInvocation,
      call: { ...samples.FormalCall, session_id: samples.FormalCall.owner_actor_id },
    }),
  )
  await expect(formalMethodInvocation(SESSION, command)).rejects.toThrow()
  for (const extra of [
    { runtime: 'invented' },
    { selection_revision: 1 },
    { formal_method: { trusted: true } },
  ]) {
    expect(() =>
      callSchema.parse({
        ...samples.FormalCall,
        detail: { ...samples.FormalCall.detail, ...extra },
      }),
    ).toThrow()
  }
})

it('restores model method history distinctly and approves once without exposing raw tool output', async () => {
  const root = samples.FormalMethodInvocation
  const record = formalMethodInvocationSchema.parse({
    ...root,
    title: '模型方法名称',
    call: {
      ...root.call,
      detail: {
        ...samples.FormalProbeCall.detail,
        execution_kind: 'formal_method_model',
        reference: root.reference,
        method_title: '模型方法名称',
      },
    },
  })
  calls = [record]
  page()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByText(t.modelOrigin)
  expect(screen.queryByText(t.manualOrigin)).not.toBeInTheDocument()
  expect(screen.getByText(zh.capabilities.formalModelMethodCall)).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: zh.capabilities.allowOnce })).toHaveLength(1)
  expect(
    screen.getByText(
      `${zh.capabilities.formalMethodOperation.replace('{tool}', record.call.detail.tool.name)}`,
    ),
  ).toBeInTheDocument()
  expect(posts).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.allowOnce }))
  await screen.findByText(/verified output/)
  expect(screen.queryByText(/raw_private_result/)).not.toBeInTheDocument()
  expect(posts).toHaveLength(1)
  expect(posts[0].body).toEqual({
    decision: 'accept',
    token: record.call.detail.approval_token,
    subject_digest: record.call.digest,
  })
})
