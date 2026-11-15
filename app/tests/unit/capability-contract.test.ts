import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assetSchema,
  catalogSchema,
  selectionSchema,
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
      1,
    )
    expect(samples.Calls.calls.map((call) => callSchema.parse(call))).toHaveLength(4)
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
