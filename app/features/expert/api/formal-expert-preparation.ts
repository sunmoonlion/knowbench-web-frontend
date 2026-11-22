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
  input_types: z.record(z.string(), z.string()),
  revision: z.number().int(),
  bindings: z.object({
    values: z.record(z.string(), z.json()),
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
    values: Preparation['bindings']['values']
    materials: Preparation['bindings']['materials']
    accounts: Preparation['bindings']['accounts']
    budget_limit: string | null
  },
) => sendJson(view, url(task), { method: 'PUT', csrfToken, body })

const methodRef = z.object({ method_id: z.uuid(), version: z.number().int(), digest: z.string() })
const preview = z.object({
  scope_hours: z.number().int().positive().optional(),
  subexperts: z
    .array(
      z.object({
        path: z.array(z.string()),
        reference: methodRef,
        title: z.string(),
        outputs: z.array(z.string()),
      }),
    )
    .optional(),
  revision: z.number().int(),
  task_id: z.uuid(),
  preview_digest: z.string(),
  currency: z.literal('CNY'),
  dispatch_gap: z.string().nullable(),
  estimated_maximum: z.string().nullable(),
  issues: z.array(
    z.object({ code: z.string(), path: z.array(z.string()), slot: z.string().nullable() }),
  ),
  steps: z.array(
    z.object({
      path: z.array(z.string()),
      kind: z.string(),
      title: z.string(),
      account: z.string().nullable(),
      permissions: z.array(
        z.object({
          operations: z.array(z.string()),
          destination: z.string(),
          fields: z.array(z.string()),
          purpose: z.string(),
        }),
      ),
      reference: methodRef,
      material: material.optional(),
      from_outputs: z.record(
        z.string(),
        z.object({ step: z.array(z.string()), output: z.string() }),
      ),
      quote: z.object({ maximum: z.string(), currency: z.literal('CNY') }).nullable(),
    }),
  ),
})
export const readExecutionPreview = (task: string, revision: number) =>
  getJson(preview, `/api/workbench/find-expert/${seg(task)}/execution-preview?revision=${revision}`)

export const submitExecution = (
  task: string,
  revision: number,
  preview_digest: string,
  csrfToken: string,
) =>
  sendJson(z.object({ task_id: z.uuid() }), `/api/workbench/find-expert/${seg(task)}/execution`, {
    method: 'PUT',
    csrfToken,
    body: { revision, preview_digest },
  })
