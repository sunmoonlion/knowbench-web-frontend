// 设置页用的契约：模型 key、新对话的默认、我的沙箱。字段以 knowbench-backend 的接口为真源。
// 带密钥的字段一律不认：多出来就当契约不符（宁可页面报错，也不让密钥进页面）。
import { z } from 'zod'

const uuid = z.uuid()
const revision = z.string().regex(/^[a-f0-9]{64}$/)
const expiry = z.iso.datetime({ offset: true }).nullable().optional()
const relayUrl = z.string().refine((value) => {
  try {
    const u = new URL(value)
    return (
      ['ws:', 'wss:'].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      !/\s/.test(value)
    )
  } catch {
    return false
  }
})
export const agentDownloadSchema = z
  .object({
    contract_version: z.literal(2),
    download: z
      .object({
        url: z.string().refine((value) => {
          try {
            const u = new URL(value)
            return (
              u.protocol === 'https:' &&
              !u.username &&
              !u.password &&
              !u.search &&
              !u.hash &&
              !/[\s\\]/.test(value)
            )
          } catch {
            return false
          }
        }),
        version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/),
        zip_sha256: revision,
        manifest_sha256: revision,
        codex_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
        size_bytes: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict()
export type AgentDownload = NonNullable<z.infer<typeof agentDownloadSchema>['download']>

export const installCommandSchema = z
  .object({
    command: z.string().min(1),
    expires_at: z.iso.datetime({ offset: true }),
  })
  .strict()

export const pairingLookupSchema = z
  .object({
    id: z.string().min(1),
    machine_name: z.string(),
    os: z.string(),
    agent_version: z.string(),
    codex_version: z.string(),
    source_ip: z.string().nullable(),
    requested_seconds_ago: z.number().int().nonnegative(),
    replaces_machine: z.string().nullable(),
  })
  .strict()

export const pairingDecisionSchema = z
  .object({
    status: z.enum(['approved', 'denied']),
    machine_name: z.string().optional(),
  })
  .strict()

export type InstallCommand = z.infer<typeof installCommandSchema>
export type PairingLookup = z.infer<typeof pairingLookupSchema>

export const prefsSchema = z
  .object({
    model: z.string().nullable(),
    approval_policy: z.enum(['untrusted', 'on-request', 'never']),
    // Codex 在云端能用哪些数据源（0021 §二之 2）
    mcp_sources: z.record(z.string(), z.boolean()).optional(),
  })
  .loose()

export const credentialSchema = z
  .object({
    id: uuid,
    provider: z.string(),
    hint: z.string(),
    status: z.enum(['active', 'revoked']),
    sandbox_id: uuid.nullable().optional(),
    // 自建或代理的接入地址；空 = 厂商默认
    base_url: z.string().nullable().optional(),
    // 列表接口还带这两个时间（后端 list_credentials 的 select）；strict 仍然挡住任何多出来的字段，尤其是密钥
    created_at: z.string().nullable().optional(),
    revoked_at: z.string().nullable().optional(),
  })
  .strict()
  .refine((c) => !('api_key' in c) && !('ciphertext' in c), {
    message: 'credential must not carry secrets',
  })

export const provisionedSandboxSchema = z
  .object({
    provision_revision: uuid.nullable().optional(),
    sandbox_id: uuid.nullable().optional(),
    app_server_url: z.string().optional(),
    status: z.string().nullable().optional(),
    ready: z.boolean().optional(),
    relay: z
      .object({
        url: relayUrl,
        user: z.string().regex(/^[a-zA-Z0-9_-]+$/),
        agent_token: z.string().nullable(),
        agent_token_expires_at: expiry,
        identity_revision: revision.optional(),
      })
      .optional(),
    relay_user: z.string().optional(),
    agent_token_expires_at: expiry,
    identity_revision: revision.optional(),
    credential_hint: z.string().optional(),
    sandbox_rolled: z.boolean().optional(),
  })
  .loose()
  .refine((s) => !('app_server_token' in s) && !('model_key' in s), {
    message: 'sandbox must not carry secrets',
  })

export const problemSchema = z
  .object({
    code: z.string(),
    status: z.number().int().optional(),
    detail: z.string().optional(),
  })
  .loose()

export type Prefs = z.infer<typeof prefsSchema>
export type Credential = z.infer<typeof credentialSchema>
export type ProvisionedSandbox = z.infer<typeof provisionedSandboxSchema>
