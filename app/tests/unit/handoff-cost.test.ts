import { afterEach, expect, it, vi } from 'vitest'
import { readHandoffs } from '@/features/expert/api/handoffs'

afterEach(() => vi.unstubAllGlobals())
it('compares a receipt waiting for settlement with one carrying no charge information', async () => {
  const id = '61023ed4-24b5-414e-928f-43074ddf28b6'
  const request = {
    role: ['review'],
    goal: '核验',
    attempt_id: id,
    reference: { method_id: id, version: 1, digest: 'v1' },
    input_digest: 'input',
    inputs: [],
  }
  const base = { state: 'CANCELLED', artifacts: [], failure: null, executor: {}, cost: null }
  const result = (pending: boolean) => ({
    parents: [
      {
        parent_call_id: id,
        scope_digest: 'scope',
        can_close: false,
        missing: [],
        closure: null,
        children: [
          {
            child_call_id: id,
            state: 'CANCELLED',
            evidence_digest: 'evidence',
            rounds: [
              {
                request,
                receipts: [{ ...base, cost_pending: pending }],
                late: [],
              },
            ],
          },
        ],
      },
    ],
  })
  for (const pending of [false, true]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result(pending))))
    const view = await readHandoffs(id)
    expect(view.parents[0].children[0].rounds[0].receipts[0]).toEqual({
      ...base,
      cost_pending: pending,
    })
  }
})
