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
    'formal_script',
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
export type RegistryAsset = z.infer<typeof installation>
export type RegisteredMethod = z.infer<typeof method>
export const registryKey = ['workbench-registry'] as const
export const registryInventory = () => getJson(inventory, '/api/workbench/registry')
export const registryInstallation = (id: string) =>
  getJson(details, `/api/workbench/registry/installed/${encodeURIComponent(id)}`)

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
export const registryActivity = () => getJson(events, '/api/workbench/registry/activity')

const source = z.object({
  source_id: z.uuid(),
  version: z.number().int().positive(),
  kind: z.enum(['script', 'instruction']),
  name: z.string(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})
export type DirectSource = z.infer<typeof source>
export type SourceInput = Pick<DirectSource, 'kind' | 'name'> & { content: string }
const sourcePath = '/api/workbench/registry/sources'
export const listSources = () => getJson(z.array(source), sourcePath)
export const loadSource = (s: DirectSource) =>
  getJson(
    source.extend({ content: z.string() }),
    `${sourcePath}/${s.source_id}/${s.version}?digest=${encodeURIComponent(s.digest)}`,
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
export const registryPlanningMethods = (offset: number) =>
  getJson(planningPage, `/api/workbench/registry/planning-methods?limit=30&offset=${offset}`)
