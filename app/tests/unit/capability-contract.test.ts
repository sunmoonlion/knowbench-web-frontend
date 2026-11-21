import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assetSchema,
  catalogSchema,
  selectionSchema,
  selectionPutSchema,
  resourceAuthorityRefSchema,
  delegationOptionSchema,
  callSchema,
} from '@/lib/workbench/capabilities'
import {
  formalMethodCatalogSchema,
  formalMethodInvocationSchema,
  formalMethodInvocationsSchema,
  formalMethodInvokeSchema,
  formalMethodValuesSchema,
} from '@/lib/workbench/formal-methods'
import samples from '@/tests/fixtures/capabilities-v1.samples.json'
import lock from '@/contracts/provider-locks/capabilities-v1.lock.json'

describe('provider-owned capability v1', () => {
  it('locks the provider schema and examples by digest', () => {
    const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(hash('contracts/provider-locks/capabilities-v1.json')).toBe(lock.sha256)
    expect(hash('contracts/provider-locks/capabilities-v1.samples.json')).toBe(lock.samples_sha256)
    expect(hash('tests/fixtures/capabilities-v1.samples.json')).toBe(lock.samples_sha256)
  })
  it('parses provider examples and rejects leaked credentials or invented approvals', () => {
    expect(assetSchema.parse(samples.Asset).detail.account_label).toBe('office@example.test')
    expect(catalogSchema.parse(samples.Catalog).assets).toHaveLength(2)
    expect(selectionSchema.parse(samples.Selection).preparation).toBe('not_prepared')
    expect(callSchema.parse(samples.Call).detail.arguments.to).toBe('reader@example.test')
    expect(() => assetSchema.parse({ ...samples.Asset, secret: 'should-never-return' })).toThrow()
    expect(() => selectionSchema.parse({ ...samples.Selection, approved: true })).toThrow()
  })
  it('parses owned method provider catalog, command and invocation examples', () => {
    expect(formalMethodCatalogSchema.parse(samples.FormalMethodCatalogResponse).items).toHaveLength(
      2,
    )
    expect(formalMethodInvokeSchema.parse(samples.FormalMethodCallRequest).reference.version).toBe(
      1,
    )
    expect(
      formalMethodInvocationSchema.parse(samples.FormalMethodInvocation).call.detail.execution_kind,
    ).toBe('formal_method')
    expect(formalMethodInvocationsSchema.parse(samples.FormalMethodInvocations).calls).toHaveLength(
      2,
    )
    expect(samples.Calls.calls.map((call) => callSchema.parse(call))).toHaveLength(5)
    expect(() =>
      formalMethodInvocationSchema.parse({
        ...samples.FormalMethodInvocation,
        outputs: { forged: true },
      }),
    ).toThrow()
  })
  it('requires an explicit host kind and rejects fabricated model authority on host calls', () => {
    const detail: Record<string, unknown> = { ...samples.Call.detail, execution_kind: 'formal_mcp' }
    delete detail.runtime
    delete detail.selection_revision
    delete detail.method
    expect(callSchema.parse({ ...samples.Call, detail }).detail.execution_kind).toBe('formal_mcp')
    for (const extra of [
      { runtime: 'invented' },
      { selection_revision: 1 },
      { method: { task_id: samples.Call.id } },
      { formal_host: { trusted: true } },
      { execution_kind: undefined },
    ]) {
      expect(() => callSchema.parse({ ...samples.Call, detail: { ...detail, ...extra } })).toThrow()
    }
    const model: Record<string, unknown> = { ...samples.Call.detail }
    delete model.runtime
    expect(() => callSchema.parse({ ...samples.Call, detail: model })).toThrow()
  })
})

it('rejects root/operation identity or state mismatches while allowing failed output validation', () => {
  const sample = samples.FormalMethodInvocation
  expect(() =>
    formalMethodInvocationSchema.parse({ ...sample, method_call_id: sample.call.id }),
  ).toThrow()
  for (const status of ['expired', 'failed', 'unknown', 'declined']) {
    expect(() => formalMethodInvocationSchema.parse({ ...sample, status })).toThrow()
  }
  expect(
    formalMethodInvocationSchema.parse({
      ...sample,
      status: 'failed',
      call: { ...sample.call, status: 'succeeded' },
    }).outputs,
  ).toBeNull()
  const values = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`key${index}`, true]),
  )
  expect(formalMethodValuesSchema.safeParse(values).success).toBe(true)
  expect(formalMethodValuesSchema.safeParse({ ...values, extra: true }).success).toBe(false)
})

it('identifies a function probe by its registered source and actual model turn', () => {
  const sample = samples.RegisteredFunctionProbe
  expect(callSchema.parse(sample).detail.execution_kind).toBe('formal_probe')
  for (const key of ['registered_source', 'selection_revision', 'runtime']) {
    const detail: Record<string, unknown> = { ...sample.detail }
    delete detail[key]
    expect(callSchema.safeParse({ ...sample, detail }).success).toBe(false)
  }
})

it('requires explicit model probe runtime references without allowing internal evidence or manual invocation', () => {
  const sample = samples.FormalProbeCall
  expect(callSchema.parse(sample).detail.execution_kind).toBe('formal_probe')
  for (const key of ['runtime', 'selection_revision', 'source_asset_id', 'connection_id']) {
    const detail: Record<string, unknown> = { ...sample.detail }
    delete detail[key]
    expect(callSchema.safeParse({ ...sample, detail }).success).toBe(false)
    expect(
      callSchema.safeParse({ ...sample, detail: { ...sample.detail, [key]: null } }).success,
    ).toBe(false)
  }
  for (const extra of [
    { formal_probe: { approved: true } },
    { formal_host: {} },
    { method: {} },
    { selection_revision: 1.5 },
  ]) {
    expect(
      callSchema.safeParse({ ...sample, detail: { ...sample.detail, ...extra } }).success,
    ).toBe(false)
  }
  expect(
    formalMethodInvocationSchema.safeParse({
      ...samples.FormalMethodInvocation,
      call: { ...sample, id: samples.FormalMethodInvocation.call.id },
    }).success,
  ).toBe(false)
})

it('keeps legacy scopes empty and bounds exact model method selections', () => {
  const reference = samples.FormalMethodInvocation.reference
  const legacy = { ...samples.Selection }
  expect(selectionSchema.parse(legacy).formal_methods).toEqual([])
  expect(selectionSchema.parse({ ...legacy, formal_methods: [reference] }).formal_methods).toEqual([
    reference,
  ])
  expect(
    selectionSchema.safeParse({
      ...legacy,
      formal_methods: [reference, { ...reference, version: reference.version + 1 }],
    }).success,
  ).toBe(false)
  expect(
    selectionSchema.safeParse({ ...legacy, formal_methods: [{ ...reference, digest: 'latest' }] })
      .success,
  ).toBe(false)
  const refs = Array.from({ length: 21 }, (_, i) => ({
    ...reference,
    method_id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
  }))
  expect(selectionSchema.safeParse({ ...legacy, formal_methods: refs.slice(0, 20) }).success).toBe(
    true,
  )
  expect(selectionSchema.safeParse({ ...legacy, formal_methods: refs }).success).toBe(false)
})
it('requires a model method reference/title and does not accept mismatched root history', () => {
  const root = samples.FormalMethodInvocation
  const detail = {
    ...samples.FormalProbeCall.detail,
    execution_kind: 'formal_method_model',
    reference: root.reference,
    method_title: root.title,
  }
  const call = { ...root.call, detail }
  expect(callSchema.parse(call).detail.execution_kind).toBe('formal_method_model')
  expect(formalMethodInvocationSchema.safeParse({ ...root, call }).success).toBe(true)
  for (const key of ['reference', 'method_title', 'runtime', 'selection_revision']) {
    const incomplete: Record<string, unknown> = { ...detail }
    delete incomplete[key]
    expect(callSchema.safeParse({ ...call, detail: incomplete }).success).toBe(false)
  }
  expect(
    callSchema.safeParse({ ...call, detail: { ...detail, formal_model: { approved: true } } })
      .success,
  ).toBe(false)
  expect(
    formalMethodInvocationSchema.safeParse({
      ...root,
      call: { ...call, detail: { ...detail, reference: { ...root.reference, version: 99 } } },
    }).success,
  ).toBe(false)
  expect(
    formalMethodInvocationSchema.safeParse({
      ...root,
      call: { ...call, detail: { ...detail, method_title: 'Other method' } },
    }).success,
  ).toBe(false)
})

it('parses provider-owned model selection, submission and history with strict caller identity', () => {
  expect(selectionSchema.parse(samples.FormalModelSelection).formal_methods).toEqual([
    samples.FormalModelCall.detail.reference,
  ])
  expect(selectionPutSchema.parse(samples.FormalModelSelectionPut).formal_methods).toEqual([
    samples.FormalModelCall.detail.reference,
  ])
  expect(callSchema.parse(samples.FormalModelCall).detail.execution_kind).toBe(
    'formal_method_model',
  )
  expect(formalMethodInvocationSchema.parse(samples.FormalModelInvocation).title).toBe(
    samples.FormalModelCall.detail.method_title,
  )
  expect(
    selectionPutSchema.safeParse({ ...samples.FormalModelSelectionPut, approved: true }).success,
  ).toBe(false)
  expect(
    selectionPutSchema.safeParse({
      ...samples.FormalModelSelectionPut,
      formal_methods: [
        samples.FormalModelCall.detail.reference,
        samples.FormalModelCall.detail.reference,
      ],
    }).success,
  ).toBe(false)
})

it('accepts only exact resource authority references in a selected method context', () => {
  const ref = { record_id: 'resource-owner.v1', revision: 1, digest: 'sha256:' + 'c'.repeat(64) }
  const tool = samples.Selection.tools[0]
  const command = {
    revision: 1,
    tools: [tool],
    method_context: 'a'.repeat(64),
    delegations: { [tool]: ref },
  }
  expect(selectionPutSchema.parse(command).delegations).toEqual({ [tool]: ref })
  expect(selectionPutSchema.parse({ revision: 1 }).delegations).toEqual({})
  expect(selectionSchema.parse(samples.Selection).delegations).toEqual({})
  for (const changed of [
    { tools: [] },
    { method_context: null },
    { delegable: true },
    { parent_call_id: samples.Call.id },
  ]) {
    expect(selectionPutSchema.safeParse({ ...command, ...changed }).success).toBe(false)
  }
  for (const changed of [
    { record_id: 'not/a/record' },
    { revision: 0 },
    { digest: 'latest' },
    { delegable: true },
    { parent_revision: 1 },
  ]) {
    expect(resourceAuthorityRefSchema.safeParse({ ...ref, ...changed }).success).toBe(false)
  }
  const option = {
    tool_key: tool,
    authority: ref,
    issuer: 'Resource owner',
    expires_at: '2099-01-01T00:00:00Z',
    binding: {
      kind: 'accepted_plan',
      parent_method_id: 'accepted:plan',
      parent_snapshot_digest: 'sha256:' + 'b'.repeat(64),
      child_method_id: 'child_method',
      child_method_version: 'v1',
    },
  }
  expect(delegationOptionSchema.safeParse(option).success).toBe(true)
  expect(
    delegationOptionSchema.safeParse({
      ...option,
      binding: { ...option.binding, kind: 'formal_method' },
    }).success,
  ).toBe(false)
  expect(
    delegationOptionSchema.safeParse({
      ...option,
      binding: { ...option.binding, child_method_id: 'unbounded/name' },
    }).success,
  ).toBe(false)
})

it('consumes provider-owned accepted-plan delegation options and exact selection references', () => {
  const selected = selectionSchema.parse(samples.ResourceDelegationSelection)
  const command = selectionPutSchema.parse(samples.ResourceDelegationSelectionPut)
  expect(selected.method?.delegation_options).toHaveLength(1)
  const option = selected.method!.delegation_options[0]
  expect(delegationOptionSchema.parse(option).binding.kind).toBe('accepted_plan')
  expect(command.delegations).toEqual({ [option.tool_key]: option.authority })
  expect(selected.delegations).toEqual(command.delegations)
  expect(command.delegations[option.tool_key]).not.toHaveProperty('delegable')
  expect(command.delegations[option.tool_key]).not.toHaveProperty('parent_call_id')
})
