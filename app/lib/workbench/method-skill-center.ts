import { z } from 'zod'
import { getJson, sendJson } from './http'
import { formalMethodReferenceSchema } from './formal-method-reference'

const installation = z.object({
  asset_id: z.uuid(),
  name: z.string(),
  kind: z.enum(['connection', 'skill']),
  revision: z.number().int(),
  status: z.enum(['active', 'disabled', 'disconnected', 'reauth_required']),
  account_label: z.string().nullable(),
})
const method = z.object({
  path: z.literal('formal'),
  method_kind: z.enum(['tool', 'expert']),
  runner_route: z.enum([
    'formal_mcp',
    'formal_a2a',
    'formal_script',
    'formal_function',
    'formal_instruction',
    'orchestration',
    'unavailable',
  ]),
  allowed_callers: z.array(z.enum(['host', 'model'])),
  reference: formalMethodReferenceSchema,
  title: z.string(),
  source_asset_id: z.uuid().nullable(),
  source_revision: z.number().int().nullable(),
  source_kind: z.string().nullable(),
  source_entry: z.string().nullable(),
  source_digest: z.string().nullable(),
  dependencies: z.array(formalMethodReferenceSchema),
})
const inventory = z.object({
  installed: z.array(installation),
  formal: z.array(method),
  native: z.array(
    z.object({
      name: z.string(),
      item_type: z.string().nullable(),
      request: z.string().nullable(),
      interaction: z.enum(['approval', 'question']).nullable(),
    }),
  ),
})
const details = installation.pick({ asset_id: true, revision: true, status: true }).extend({
  path: z.literal('installed'),
  entries: z.array(
    z.object({ kind: z.string(), entry: z.string(), tool_key: z.string().nullable() }),
  ),
})
export type MethodSkillCenterAsset = z.infer<typeof installation>
export type RegisteredMethod = z.infer<typeof method>
export const methodSkillCenterKey = ['workbench-method-skill-center'] as const
export const methodSkillCenterInventory = () =>
  getJson(inventory, '/api/workbench/method-skill-center')
export const methodSkillCenterInstallation = (id: string) =>
  getJson(details, `/api/workbench/method-skill-center/installed/${encodeURIComponent(id)}`)

const events = z.array(
  z.object({
    kind: z.enum(['call', 'approval', 'observation', 'task']),
    session_id: z.uuid(),
    record_id: z.string(),
    path: z.enum(['installed', 'formal', 'native', 'platform', 'runtime', 'registered_source']),
    source: z
      .object({ source_id: z.uuid(), version: z.number().int(), digest: z.string() })
      .nullish(),
    asset_id: z.uuid().nullable(),
    reference: formalMethodReferenceSchema.nullable(),
    action: z.string(),
    status: z.string(),
    at: z.string(),
  }),
)
export const methodSkillCenterActivity = () =>
  getJson(events, '/api/workbench/method-skill-center/activity')

const source = z.object({
  source_id: z.uuid(),
  version: z.number().int().positive(),
  kind: z.enum(['script', 'instruction']),
  name: z.string(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})
export type DirectSource = z.infer<typeof source>
export type SourceInput = Pick<DirectSource, 'kind' | 'name'> & { content: string }
const sourcePath = '/api/workbench/method-skill-center/sources'
export const listSources = () => getJson(z.array(source), sourcePath)
export const loadSource = (s: DirectSource) =>
  getJson(
    source.extend({ content: z.string() }),
    `${sourcePath}/${s.source_id}/${s.version}?digest=${encodeURIComponent(s.digest)}`,
  )
export const withdrawSource = (s: DirectSource, csrfToken: string) =>
  sendJson(
    z.object({ withdrawn: z.literal(true) }),
    `${sourcePath}/${s.source_id}/${s.version}?digest=${encodeURIComponent(s.digest)}`,
    { method: 'DELETE', csrfToken },
  )
export const saveSource = (id: string, version: number, body: SourceInput, csrfToken: string) =>
  sendJson(source, `${sourcePath}/${id}/${version}`, { method: 'PUT', body, csrfToken })

const planningPage = z.object({
  items: z.array(
    z.object({
      method_id: z.uuid(),
      latest_version: z.number().int().positive(),
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      method_kind: z.enum(['tool', 'expert']),
      title: z.string(),
      summary: z.string(),
    }),
  ),
  next: z.number().int().nonnegative().nullable(),
})
export type PlanningQuery =
  | { stage: 'directory' }
  | { stage: 'expert' | 'composition'; question: string }
export const methodSkillCenterPlanningMethods = (
  offset: number,
  query: PlanningQuery,
  csrfToken: string,
) =>
  sendJson(
    planningPage,
    `/api/workbench/method-skill-center/planning-methods?limit=30&offset=${offset}`,
    { method: 'POST', body: query, csrfToken },
  )

export async function planningDeclaration(
  reference: z.infer<typeof formalMethodReferenceSchema>,
  csrfToken: string,
) {
  const result = await sendJson(
    z.object({
      reference: formalMethodReferenceSchema,
      promise_outputs: z.record(z.string(), z.array(z.string())),
      declaration: z.object({
        title: z.string(),
        purpose: z.string(),
        applies_when: z.array(z.string()),
        excludes: z.array(z.string()),
        promises: z.record(z.string(), z.string()),
        conditions: z
          .record(z.string(), z.object({ when: z.string(), input_slots: z.array(z.string()) }))
          .optional(),
      }),
    }),
    '/api/workbench/method-skill-center/planning-methods/declaration',
    { method: 'POST', body: reference, csrfToken },
  )
  if (
    result.reference.method_id !== reference.method_id ||
    result.reference.version !== reference.version ||
    result.reference.digest !== reference.digest
  )
    throw new Error('Unexpected method version')
  return { ...result.declaration, outputs: result.promise_outputs }
}
