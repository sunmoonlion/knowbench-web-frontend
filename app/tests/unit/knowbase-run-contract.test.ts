import { afterEach, describe, expect, it, vi } from 'vitest'
import { runSchema, taskDataSchema } from '@/contracts/workbench-v2'
import { getJson } from '@/lib/workbench/http'
import { sessionRecovery } from '@/lib/auth/session-recovery'
import fixture from '@/tests/fixtures/knowbase-run.json'

afterEach(() => sessionRecovery.recover())
describe('provider-recorded nonempty knowbase contract', () => {
  it('parses the actual steps and data HTTP responses', async () => {
    const fetcher = vi.fn(async () => Response.json(fixture.steps))
    const run = await getJson(runSchema, '/api/workbench/tasks/test/steps', fetcher)
    expect(run.task.chosen_data?.[0].source).toBe('knowbase')
    expect(taskDataSchema.parse(fixture.data).requests).toHaveLength(1)
  })
  it('accepts ten pins but rejects retired or unknown sources', () => {
    const sample = structuredClone(fixture.steps)
    sample.task.chosen_data = Array.from({ length: 10 }, () => ({ ...sample.task.chosen_data[0] }))
    expect(runSchema.safeParse(sample).success).toBe(true)
    for (const source of ['cloud', 'local', 'unknown']) {
      sample.task.chosen_data[0].source = source
      expect(runSchema.safeParse(sample).success).toBe(false)
    }
  })
  it('still detects a lost browser session on remote-agent routes without retrying a write', async () => {
    const fetcher = vi.fn(async () => Response.json({ code: 'auth_required' }, { status: 401 }))
    await expect(
      getJson(runSchema, '/api/workbench/environments/test/remote/info', fetcher),
    ).rejects.toMatchObject({ status: 401 })
    expect(sessionRecovery.snapshot()).toBe(true)
    expect(fetcher.mock.calls).toHaveLength(2)
  })
  it('keeps HTTP 401 distinct from HTTP 200 contract errors', async () => {
    await expect(
      getJson(
        runSchema,
        '/api/workbench/tasks/test/steps',
        vi.fn(async () => Response.json({ code: 'auth_required' }, { status: 401 })),
      ),
    ).rejects.toMatchObject({ code: 'auth_required', status: 401 })
    expect(sessionRecovery.snapshot()).toBe(true)
    sessionRecovery.recover()
    await expect(
      getJson(
        runSchema,
        '/api/workbench/tasks/test/steps',
        vi.fn(async () => Response.json({})),
      ),
    ).rejects.toMatchObject({ code: 'contract_invalid', status: 200 })
    expect(sessionRecovery.snapshot()).toBe(false)
  })
})
