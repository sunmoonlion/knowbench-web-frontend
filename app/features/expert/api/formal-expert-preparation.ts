import { z } from 'zod'
import { getJson, seg, sendJson } from '@/lib/workbench/http'

const material = z.object({
  material_id: z.uuid(),
  version_no: z.number().int(),
  sha256: z.string(),
})
const account = z.object({
  asset_id: z.uuid(),
  revision: z.number().int(),
  policies_digest: z.string(),
})
const view = z.object({
  revision: z.number().int(),
  bindings: z.object({
    materials: z.record(z.string(), material),
    accounts: z.record(z.string(), account),
    budget: z.object({ currency: z.literal('CNY'), limit: z.string().nullable() }).nullable(),
  }),
  account_options: z.record(
    z.string(),
    z.array(z.object({ pin: account, name: z.string(), account_label: z.string() })),
  ),
  materials: z.array(material.extend({ name: z.string() })),
  material_names: z.record(z.string(), z.string()),
  invalid_materials: z.array(z.string()),
  invalid_accounts: z.array(z.string()),
})
export type Preparation = z.infer<typeof view>
const url = (task: string) => `/api/workbench/find-expert/${seg(task)}/preparation`
export const readPreparation = (task: string, library = false) =>
  getJson(view, url(task) + (library ? '?library=true' : ''))
export const savePreparation = (
  task: string,
  csrfToken: string,
  body: {
    review_digest: string
    expected_revision: number
    materials: Preparation['bindings']['materials']
    accounts: Preparation['bindings']['accounts']
    budget_limit: string | null
  },
) => sendJson(view, url(task), { method: 'PUT', csrfToken, body })
