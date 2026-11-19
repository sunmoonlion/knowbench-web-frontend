import {
  formalMethodSelectionsSchema,
  formalMethodReferenceSchema,
} from './formal-method-reference'
import { z } from 'zod'
import { getJson, sendJson } from '@/lib/workbench/http'

export const methodRequirementsSchema = z
  .object({
    tools: z.array(
      z.object({ url: z.string(), name: z.string(), requirement_id: z.string() }).strict(),
    ),
    skills: z.array(
      z
        .object({
          name: z.string(),
          version: z.string(),
          digest: z.string(),
          required_tools: z
            .array(z.object({ url: z.string(), name: z.string() }).strict())
            .optional(),
        })
        .strict(),
    ),
  })
  .strict()

export const accessRequirementSchema = z
  .object({
    requirement_id: z.string(),
    capability_ref: z.string(),
    version: z.string(),
    operations: z.array(z.string()),
    resources: z.array(
      z
        .object({
          resource_kind: z.literal('connector'),
          resource_role: z.string(),
          values: z.array(z.string()),
        })
        .strict(),
    ),
    data_transfer: z
      .object({
        destination: z.string(),
        argument_fields: z.array(z.string()),
        purpose: z.string(),
      })
      .strict(),
    required_when: z.literal('always'),
    on_unavailable: z.literal('pause'),
  })
  .strict()

const tool = z
  .object({
    key: z.string().optional(),
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
  })
  .strict()
export type ToolRequirement = { url: string; name: string }
export const skillDependencySchema = z
  .object({
    service_url: z.string().nullable(),
    tool_name: z.string(),
    legacy_tool_key: z.string().nullable().optional(),
    status: z.enum([
      'available',
      'selected',
      'selection_required',
      'connection_required',
      'connection_inactive',
    ]),
    candidates: z.array(
      z
        .object({
          key: z.string(),
          connection_id: z.uuid(),
          connection_name: z.string(),
          account_label: z.string(),
          status: z.string(),
        })
        .strict(),
    ),
  })
  .strict()
export type SkillDependency = z.infer<typeof skillDependencySchema>
const detail = z
  .object({
    url: z.string().optional(),
    account_label: z.string().optional(),
    auth: z.string().optional(),
    oauth: z
      .object({
        provider_id: z.string(),
        protocol: z.enum(['mcp', 'a2a']),
        issuer: z.string(),
        account_id: z.string(),
        scopes: z.array(z.string()),
      })
      .strict()
      .nullish(),
    reauth_reason: z.string().nullish(),
    tools: z.array(tool).optional(),
    checked_at: z.string().optional(),
    revocation: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    digest: z.string().optional(),
    dependencies: z.array(z.string()).optional(),
    tool_requirements: z.array(z.object({ url: z.string(), name: z.string() }).strict()).optional(),
    dependency_status: z.array(skillDependencySchema).optional(),
    format: z.string().optional(),
    source: z
      .object({ repository: z.string(), commit: z.string(), path: z.string() })
      .strict()
      .nullable()
      .optional(),
    files: z
      .array(
        z
          .object({
            path: z.string(),
            size: z.number().int(),
            sha256: z.string(),
            media_type: z.string(),
          })
          .strict(),
      )
      .optional(),
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
    services: z.array(
      z
        .object({
          url: z.string(),
          authentication: z.array(z.string()),
          provider_id: z.string().nullish(),
          protocol: z.enum(['mcp', 'a2a']).nullish(),
        })
        .strict(),
    ),
    skill_formats: z.array(z.string()),
    runtime_enabled: z.boolean(),
    script_execution_enabled: z.boolean().optional(),
  })
  .strict()
export const resourceAuthorityRefSchema = z
  .object({
    record_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    revision: z.number().int().min(1),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict()
const delegationIdentity = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
export const delegationOptionSchema = z
  .object({
    tool_key: z.string().min(1).max(256),
    authority: resourceAuthorityRefSchema,
    issuer: z.string().min(1).max(200),
    expires_at: z.iso.datetime({ offset: true }),
    binding: z
      .object({
        kind: z.literal('accepted_plan').default('accepted_plan'),
        parent_method_id: delegationIdentity,
        parent_snapshot_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        child_method_id: delegationIdentity,
        child_method_version: delegationIdentity,
      })
      .strict(),
  })
  .strict()
export type ResourceAuthorityRef = z.infer<typeof resourceAuthorityRefSchema>
export type DelegationOption = z.infer<typeof delegationOptionSchema>
const delegations = z.record(z.string(), resourceAuthorityRefSchema).default({})
export const selectionPutSchema = z
  .object({
    revision: z.number().int().min(0),
    tools: z.array(z.string()).max(50).default([]),
    skills: z.array(z.string()).max(10).default([]),
    formal_methods: formalMethodSelectionsSchema.default([]),
    delegations,
    purpose: z.string().max(1000).default(''),
    skill_mode: z.enum(['auto', 'explicit']).default('explicit'),
    method_context: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    (v) =>
      Object.keys(v.delegations).length <= 50 &&
      Object.keys(v.delegations).every((key) => v.tools.includes(key)) &&
      (!Object.keys(v.delegations).length || v.method_context !== null) &&
      new Set(v.tools).size === v.tools.length &&
      new Set(v.skills).size === v.skills.length &&
      (v.skill_mode !== 'auto' || v.skills.length === 0),
  )
export const selectionSchema = z
  .object({
    session_id: z.uuid(),
    formal_methods: formalMethodSelectionsSchema.default([]),
    delegations,
    method: z
      .object({
        task_id: z.uuid(),
        profile_id: z.string(),
        step_id: z.string().nullable(),
        declared_tools: z.array(z.string()),
        managed_bindings_supported: z.boolean(),
        context: z.string().nullable().optional(),
        requirements: methodRequirementsSchema.nullable().optional(),
        access_requirements: z.array(accessRequirementSchema),
        permission_status: z.enum(['not_required', 'unconfirmed', 'active', 'revoked', 'expired']),
        delegation_options: z.array(delegationOptionSchema).default([]),
      })
      .strict()
      .nullable(),
    revision: z.number().int(),
    tools: z.array(z.string()),
    skills: z.array(z.string()),
    skill_mode: z.enum(['auto', 'explicit']),
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
const callDetail = z.object({
  source_asset_id: z.uuid().nullable().optional(),
  connection_id: z.uuid().nullable(),
  revision: z.number(),
  connection_name: z.string(),
  account_label: z.string(),
  purpose: z.string(),
  tool,
  arguments: z.record(z.string(), z.unknown()),
  approval_token: z.string(),
  result: z.unknown().optional(),
})
const modelCallDetail = callDetail
  .extend({
    selection_revision: z.number(),
    runtime: z.string(),
    method: z.record(z.string(), z.string()).nullable().optional(),
    execution_kind: z.literal('skill_script').nullable().optional(),
  })
  .strict()
const hostCallDetail = callDetail
  .extend({
    execution_kind: z.enum(['formal_mcp', 'formal_method']),
    source_asset_id: z.uuid(),
    connection_id: z.uuid(),
  })
  .strict()
const modelProbeCallDetail = callDetail
  .extend({
    execution_kind: z.literal('formal_probe'),
    source_asset_id: z.uuid(),
    connection_id: z.uuid(),
    selection_revision: z.number().int(),
    runtime: z.string(),
  })
  .strict()
const formalModelCallDetail = callDetail
  .extend({
    execution_kind: z.literal('formal_method_model'),
    source_asset_id: z.uuid(),
    connection_id: z.uuid(),
    selection_revision: z.number().int(),
    runtime: z.string(),
    reference: formalMethodReferenceSchema,
    method_title: z.string(),
  })
  .strict()
export const capabilityCallStatusSchema = z.enum([
  'awaiting_approval',
  'dispatching',
  'succeeded',
  'failed',
  'declined',
  'unknown',
  'expired',
])
export const callSchema = z
  .object({
    id: z.uuid(),
    owner_actor_id: z.uuid(),
    session_id: z.uuid(),
    source_asset_id: z.uuid().nullable().optional(),
    connection_id: z.uuid().nullable(),
    interaction_id: z.uuid().nullable(),
    digest: z.string(),
    status: capabilityCallStatusSchema,
    created_at: z.string(),
    updated_at: z.string(),
    detail: z.union([modelCallDetail, hostCallDetail, modelProbeCallDetail, formalModelCallDetail]),
  })
  .strict()
export type CapabilityCall = z.infer<typeof callSchema>
export const cancelScript = (callId: string, csrfToken: string) =>
  sendJson(callSchema, `/api/workbench/capability-calls/${callId}/cancel`, { csrfToken, body: {} })
export const scriptResultSchema = z.object({
  exit_code: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timed_out: z.boolean(),
  output_truncated: z.boolean(),
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string(), download_url: z.string() })),
  artifact_error: z.string().nullable().optional(),
})
const base = '/api/workbench'
export const catalog = () => getJson(catalogSchema, `${base}/capabilities`)
export const installedInstructions = (id: string) =>
  getJson(z.string(), `${base}/capabilities/skills/${encodeURIComponent(id)}/instructions`)
export type ConnectionService = z.infer<typeof catalogSchema>['services'][number]
export async function authorizeConnection(
  provider_id: string,
  name: string,
  locale: string,
  csrfToken: string,
  returnTo: string | null,
  asset?: Asset,
) {
  const response = await sendJson(
    z.object({ authorization_url: z.url({ protocol: /^https$/ }) }).strict(),
    `${base}/capabilities/oauth/start`,
    {
      csrfToken,
      body: {
        provider_id,
        name,
        locale,
        ...(returnTo && { return_to: returnTo }),
        ...(asset && { connection_id: asset.id, revision: asset.revision }),
      },
    },
  )
  window.location.assign(response.authorization_url)
}

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
    dependencies?: string[]
    tool_requirements?: ToolRequirement[]
  },
  csrfToken: string,
) => sendJson(assetSchema, `${base}/capabilities/skills`, { csrfToken, body })
export const assetAction = (id: string, revision: number, action: string, csrfToken: string) =>
  sendJson(assetSchema, `${base}/capabilities/${encodeURIComponent(id)}/actions`, {
    csrfToken,
    body: { revision, action },
  })

export const createSkillPackage = (
  body: {
    request_id: string
    name: string
    description: string
    version: string
    archive_base64: string
    dependencies?: string[]
    tool_requirements?: ToolRequirement[]
  },
  csrfToken: string,
) => sendJson(assetSchema, `${base}/capabilities/skill-packages`, { csrfToken, body })

export async function readSkillUpload(file: File) {
  const zip = file.name.toLowerCase().endsWith('.zip')
  if (
    (!zip && !file.name.toLowerCase().endsWith('.md')) ||
    file.size > (zip ? 2 * 1024 * 1024 : 65536)
  )
    throw new Error('invalid_skill_file')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!zip) return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), archive: '' }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { content: '', archive: btoa(binary) }
}
export const selection = (id: string) =>
  getJson(selectionSchema, `${base}/sessions/${encodeURIComponent(id)}/capabilities`)
export const saveSelection = (
  id: string,
  body: z.input<typeof selectionPutSchema>,
  csrfToken: string,
) =>
  sendJson(selectionSchema, `${base}/sessions/${encodeURIComponent(id)}/capabilities`, {
    csrfToken,
    method: 'PUT',
    body: selectionPutSchema.parse(body),
  })
export const revokeMethodPermissions = (
  id: string,
  body: { revision: number; method_context: string },
  csrfToken: string,
) =>
  sendJson(
    selectionSchema,
    `${base}/sessions/${encodeURIComponent(id)}/capabilities/revoke-method`,
    {
      csrfToken,
      body,
    },
  )
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

export const skillSourcePreviewSchema = z
  .object({
    repository: z.string(),
    commit: z.string(),
    candidates: z.array(
      z
        .object({
          path: z.string(),
          name: z.string(),
          description: z.string(),
          digest: z.string(),
          files: z.number().int(),
          has_scripts: z.boolean(),
          instructions: z.string(),
        })
        .strict(),
    ),
  })
  .strict()
export type SkillSourcePreview = z.infer<typeof skillSourcePreviewSchema>
export const previewSkillSource = (url: string, csrfToken: string) =>
  sendJson(skillSourcePreviewSchema, `${base}/capabilities/skill-sources/preview`, {
    csrfToken,
    body: { url },
  })
export const installSkillSource = (
  body: {
    request_id: string
    url: string
    commit: string
    path: string
    digest: string
    dependencies?: string[]
    tool_requirements?: ToolRequirement[]
  },
  csrfToken: string,
) => sendJson(assetSchema, `${base}/capabilities/skill-sources/install`, { csrfToken, body })
