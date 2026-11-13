import { z } from 'zod'
import { getJson, sendJson } from '@/lib/workbench/http'

const tool = z
  .object({
    key: z.string().optional(),
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
  })
  .strict()
const detail = z
  .object({
    url: z.string().optional(),
    account_label: z.string().optional(),
    auth: z.string().optional(),
    tools: z.array(tool).optional(),
    checked_at: z.string().optional(),
    revocation: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    content: z.string().optional(),
    digest: z.string().optional(),
    dependencies: z.array(z.string()).optional(),
    format: z.string().optional(),
  })
  .strict()
export const assetSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['connection', 'skill']),
    name: z.string(),
    revision: z.number().int(),
    status: z.string(),
    default_selected: z.boolean(),
    detail,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict()
export type Asset = z.infer<typeof assetSchema>
export const catalogSchema = z
  .object({
    assets: z.array(assetSchema),
    services: z.array(z.object({ url: z.string(), authentication: z.array(z.string()) }).strict()),
    skill_formats: z.array(z.string()),
    runtime_enabled: z.boolean(),
  })
  .strict()
export const selectionSchema = z
  .object({
    session_id: z.uuid(),
    method: z
      .object({
        task_id: z.uuid(),
        profile_id: z.string(),
        step_id: z.string().nullable(),
        declared_tools: z.array(z.string()),
        managed_bindings_supported: z.literal(false),
      })
      .strict()
      .nullable(),
    revision: z.number().int(),
    tools: z.array(z.string()),
    skills: z.array(z.string()),
    purpose: z.string(),
    editable: z.boolean(),
    applied_revision: z.number().nullable(),
    preparation: z.string(),
    issues: z.array(z.object({ ref: z.string(), code: z.string() }).strict()),
    available_tools: z.array(
      tool.extend({
        key: z.string(),
        connection_id: z.uuid(),
        connection_name: z.string(),
        account_label: z.string(),
        status: z.string(),
      }),
    ),
    available_skills: z.array(assetSchema),
  })
  .strict()
export type Selection = z.infer<typeof selectionSchema>
export const callSchema = z
  .object({
    id: z.uuid(),
    owner_actor_id: z.uuid(),
    session_id: z.uuid(),
    connection_id: z.uuid(),
    interaction_id: z.uuid().nullable(),
    digest: z.string(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    detail: z
      .object({
        connection_id: z.uuid(),
        revision: z.number(),
        connection_name: z.string(),
        account_label: z.string(),
        purpose: z.string(),
        tool,
        arguments: z.record(z.string(), z.unknown()),
        selection_revision: z.number(),
        runtime: z.string(),
        approval_token: z.string(),
        result: z.unknown().optional(),
      })
      .strict(),
  })
  .strict()
export type CapabilityCall = z.infer<typeof callSchema>
const base = '/api/workbench'
export const catalog = () => getJson(catalogSchema, `${base}/capabilities`)
export const createConnection = (
  body: { request_id: string; name: string; url: string; account_label: string; token?: string },
  csrfToken: string,
) => sendJson(assetSchema, `${base}/capabilities/connections`, { csrfToken, body })
export const createSkill = (
  body: {
    request_id: string
    name: string
    description: string
    version: string
    content: string
    dependencies: string[]
  },
  csrfToken: string,
) => sendJson(assetSchema, `${base}/capabilities/skills`, { csrfToken, body })
export const assetAction = (id: string, revision: number, action: string, csrfToken: string) =>
  sendJson(assetSchema, `${base}/capabilities/${encodeURIComponent(id)}/actions`, {
    csrfToken,
    body: { revision, action },
  })
export const selection = (id: string) =>
  getJson(selectionSchema, `${base}/sessions/${encodeURIComponent(id)}/capabilities`)
export const saveSelection = (
  id: string,
  body: Pick<Selection, 'revision' | 'tools' | 'skills' | 'purpose'>,
  csrfToken: string,
) =>
  sendJson(selectionSchema, `${base}/sessions/${encodeURIComponent(id)}/capabilities`, {
    csrfToken,
    method: 'PUT',
    body,
  })
export const calls = (id: string) =>
  getJson(
    z.object({ calls: z.array(callSchema) }).strict(),
    `${base}/sessions/${encodeURIComponent(id)}/capability-calls`,
  )
export const decide = (call: CapabilityCall, decision: 'accept' | 'decline', csrfToken: string) =>
  sendJson(callSchema, `${base}/capability-calls/${call.id}/decision`, {
    csrfToken,
    body: { decision, token: call.detail.approval_token, subject_digest: call.digest },
  })

export const renewConnection = (id: string, revision: number, token: string, csrfToken: string) =>
  sendJson(assetSchema, `${base}/capabilities/${encodeURIComponent(id)}/renew`, {
    csrfToken,
    body: { revision, ...(token ? { token } : {}) },
  })
