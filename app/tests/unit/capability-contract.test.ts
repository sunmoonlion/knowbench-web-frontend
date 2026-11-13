import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assetSchema,
  catalogSchema,
  selectionSchema,
  callSchema,
} from '@/lib/workbench/capabilities'
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
})
