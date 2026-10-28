// 契约对着样例检查。样例是真后端录下来的返回，所以这等于拿真接口的返回来验我们手写的契约。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import {
  conversationViewSchema,
  conversationsSchema,
  eventsPageSchema,
  machinesSchema,
  overviewSchema,
  packsSchema,
  projectDetailSchema,
  reviewPlaceSchema,
  pendingListSchema,
  projectsSchema,
  sandboxesSchema,
  reviewSchema,
  runSchema,
  runStepDetailSchema,
  usageSchema,
  workspacesSchema,
} from '@/contracts/workbench-v2'

const ID = '[0-9a-f-]{36}'
const contracts: [RegExp, z.ZodType][] = [
  [/^\/api\/workbench\/workspaces$/, workspacesSchema],
  [/^\/api\/workbench\/projects$/, projectsSchema],
  [/^\/api\/workbench\/sessions$/, conversationsSchema],
  [/^\/api\/workbench\/interactions$/, pendingListSchema],
  [/^\/api\/workbench\/environments$/, machinesSchema],
  [/^\/api\/workbench\/sandboxes$/, sandboxesSchema],
  [new RegExp(`^/api/workbench/sessions/${ID}$`), conversationViewSchema],
  [new RegExp(`^/api/workbench/sessions/${ID}/events$`), eventsPageSchema],
  [new RegExp(`^/api/workbench/sessions/${ID}/usage$`), usageSchema],
  [new RegExp(`^/api/workbench/tasks/${ID}/steps$`), runSchema],
  [new RegExp(`^/api/workbench/tasks/${ID}/steps/\\d+$`), runStepDetailSchema],
  [new RegExp(`^/api/workbench/interactions/${ID}$`), reviewSchema],
  [new RegExp(`^/api/workbench/interactions/${ID}$`), reviewPlaceSchema],
  [/^\/api\/workbench\/expert\/overview$/, overviewSchema],
  [/^\/api\/workbench\/packs$/, packsSchema],
  [new RegExp(`^/api/workbench/projects/${ID}$`), projectDetailSchema],
]

const fixtures = join(process.cwd(), 'preview/fixtures')

describe('契约认得样例里的每一份返回', () => {
  const scenarios = readdirSync(fixtures)
  let checked = 0
  it.each(scenarios)('情景 %s', (scenario) => {
    const directory = join(fixtures, scenario)
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
      responses: { method: string; path: string; status: number; file: string }[]
    }
    for (const response of manifest.responses) {
      if (response.method !== 'GET' || response.status !== 200) continue
      // 一个地址可以有不止一份契约（同一份返回，不同的页面各取所需）
      for (const [pattern, contract] of contracts) {
        if (!pattern.test(response.path)) continue
        const body = JSON.parse(readFileSync(join(directory, response.file), 'utf8'))
        const parsed = contract.safeParse(body)
        expect(parsed.success ? null : `${response.path}: ${parsed.error.message}`).toBeNull()
        checked += 1
      }
    }
  })
  it('不是什么都没检查', () => {
    expect(checked).toBeGreaterThan(120)
  })
})
