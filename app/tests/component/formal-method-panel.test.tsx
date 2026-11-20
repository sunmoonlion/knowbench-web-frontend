import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CapabilityPanel } from '@/components/workbench/capability-panel'
import { WorkbenchProvider } from '@/lib/workbench/context'
import {
  formalMethodInvocationSchema,
  formalMethodInvocation,
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
let calls: ReturnType<typeof formalMethodInvocationSchema.parse>[] = []
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
  calls = []
  posts = []
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (init.method && init.method !== 'GET') {
      const body = JSON.parse(String(init.body))
      posts.push({ url, body, headers: init.headers })
      if (url.endsWith('/decision')) {
        const record = calls.find((c) => url.includes(c.call.id))!
        record.call.status = body.decision === 'decline' ? 'declined' : 'succeeded'
        record.status = record.call.status
        record.outputs = record.status === 'succeeded' ? { summary: 'verified output' } : null
        record.call.detail.result = { raw_private_result: 'not typed output' }
        record.detail = 'Call settled'
        record.call.updated_at = '2099-01-01T00:00:00Z'
        return Response.json(record.call)
      }
      throw new Error('Unexpected mutation ' + url)
    }
    if (url.endsWith('/formal-methods?caller=model')) return Response.json({ items: [] })
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
it('opens the model scope without loading a manual method catalog or offering a manual action', async () => {
  page()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByText(zh.formalMethodSelection.title)
  expect(screen.queryByText('手动调用本人方法')).not.toBeInTheDocument()
  expect(screen.queryByText('使用我的方法')).not.toBeInTheDocument()
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/formal-methods'))).toBe(false)
  expect(posts).toHaveLength(0)
})

it.each(['accept', 'decline'] as const)(
  'settles a pre-existing manual approval: %s',
  async (decision) => {
    calls = [formalMethodInvocationSchema.parse(samples.FormalMethodInvocation)]
    page()
    fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: decision === 'accept' ? zh.capabilities.allowOnce : zh.capabilities.decline,
      }),
    )
    await screen.findByRole('region', {
      name: `${calls[0].title} · ${t.status[decision === 'accept' ? 'succeeded' : 'declined']}`,
    })
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toMatch(/\/decision$/)
    expect(new Headers(posts[0].headers).get('X-CSRF-Token')).toBe(csrf)
  },
)

it('shows an unknown historical outcome without offering approval or replay', async () => {
  const record = samples.FormalMethodInvocation
  calls = [
    formalMethodInvocationSchema.parse({
      ...record,
      status: 'unknown',
      call: { ...record.call, status: 'unknown' },
    }),
  ]
  page()
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByText(t.unknown)
  expect(screen.queryByRole('button', { name: zh.capabilities.allowOnce })).not.toBeInTheDocument()
  expect(posts).toHaveLength(0)
})

it('restores method history using GET and does not claim method success from raw child success', async () => {
  const record = structuredClone(samples.FormalMethodInvocation)
  calls = [
    formalMethodInvocationSchema.parse({
      ...record,
      status: 'failed',
      title: samples.FormalMethodInvocation.title,
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
  const section = await screen.findByRole('region', {
    name: `${samples.FormalMethodInvocation.title} · ${t.status.failed}`,
  })
  expect(within(section).getByText('Output schema did not match')).toBeInTheDocument()
  expect(screen.queryByText(t.validatedOutputs)).not.toBeInTheDocument()
  expect(screen.queryByText(/raw_private_result/)).not.toBeInTheDocument()
  expect(posts).toHaveLength(0)
})
it('does not enable the new entry on an ordinary expert capability panel', async () => {
  page(false)
  fireEvent.click(screen.getByRole('button', { name: zh.capabilities.thisRun }))
  await screen.findByText(zh.capabilities.selectionHint)
  expect(screen.queryByText(t.history)).not.toBeInTheDocument()
  expect(fetcher.mock.calls.some(([url]) => url.includes('/formal-method'))).toBe(false)
})
it('rejects another session or reference and rejects model authority fields on formal calls', async () => {
  const command = samples.FormalMethodCallRequest
  fetcher.mockImplementation(async () =>
    Response.json({
      ...samples.FormalMethodInvocation,
      reference: { ...command.reference, version: 2 },
    }),
  )
  await expect(formalMethodInvocation(SESSION, command)).rejects.toThrow()
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
