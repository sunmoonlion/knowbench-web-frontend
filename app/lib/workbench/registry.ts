import { z } from 'zod'
import { getJson } from './http'
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
    kind: z.enum(['call', 'approval', 'observation']),
    session_id: z.uuid(),
    record_id: z.string(),
    path: z.enum(['installed', 'formal', 'native', 'platform', 'runtime']),
    asset_id: z.uuid().nullable(),
    reference: formalMethodReferenceSchema.nullable(),
    action: z.string(),
    status: z.string(),
    at: z.string(),
  }),
)
export const registryActivity = () => getJson(events, '/api/workbench/registry/activity')
