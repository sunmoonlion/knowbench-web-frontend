// 我的机器：安装包、沙箱和代理身份。复用工作台的鉴权、CSRF 与无缓存请求。
import { z } from 'zod'
import {
  agentDownloadSchema,
  installCommandSchema,
  pairingDecisionSchema,
  pairingLookupSchema,
  provisionedSandboxSchema,
  type InstallCommand,
  type PairingLookup,
  type ProvisionedSandbox,
} from '@/contracts/workbench-settings'
import { getJson, sendJson } from '@/lib/workbench/http'

type Fetch = typeof fetch

export function provisionSandbox(
  csrfToken: string,
  fetchImpl: Fetch = fetch,
): Promise<ProvisionedSandbox> {
  return sendJson(
    provisionedSandboxSchema,
    '/api/workbench/sandboxes/provision',
    { csrfToken },
    fetchImpl,
  )
}
export function provisionedSandboxStatus(fetchImpl: Fetch = fetch): Promise<ProvisionedSandbox> {
  return getJson(provisionedSandboxSchema, '/api/workbench/sandboxes/provisioned', fetchImpl)
}
export async function deprovisionSandbox(
  csrfToken: string,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  await sendJson(
    z.object({ status: z.string() }).loose(),
    '/api/workbench/sandboxes/provisioned',
    { csrfToken, method: 'DELETE' },
    fetchImpl,
  )
}
export function rotateRelayIdentity(
  csrfToken: string,
  expectedRevision: string,
  fetchImpl: Fetch = fetch,
): Promise<ProvisionedSandbox> {
  return sendJson(
    provisionedSandboxSchema,
    '/api/workbench/sandboxes/relay-identity/rotate',
    { csrfToken, body: { expected_revision: expectedRevision } },
    fetchImpl,
  )
}
export function fetchAgentDownload(fetchImpl: Fetch = fetch) {
  return getJson(agentDownloadSchema, '/api/workbench/agent/download', fetchImpl)
}
export function issueInstallCommand(
  csrfToken: string,
  fetchImpl: Fetch = fetch,
): Promise<InstallCommand> {
  return sendJson(
    installCommandSchema,
    '/api/workbench/agent/install-command',
    { csrfToken },
    fetchImpl,
  )
}
export function lookupPairing(
  csrfToken: string,
  userCode: string,
  fetchImpl: Fetch = fetch,
): Promise<PairingLookup> {
  return sendJson(
    pairingLookupSchema,
    '/api/workbench/agent-pairing/lookup',
    { csrfToken, body: { user_code: userCode } },
    fetchImpl,
  )
}
export function approvePairing(
  csrfToken: string,
  id: string,
  userCode: string,
  fetchImpl: Fetch = fetch,
) {
  return sendJson(
    pairingDecisionSchema,
    `/api/workbench/agent-pairing/${encodeURIComponent(id)}/approve`,
    { csrfToken, body: { user_code: userCode } },
    fetchImpl,
  )
}
export function denyPairing(csrfToken: string, id: string, fetchImpl: Fetch = fetch) {
  return sendJson(
    pairingDecisionSchema,
    `/api/workbench/agent-pairing/${encodeURIComponent(id)}/deny`,
    { csrfToken },
    fetchImpl,
  )
}

const removedMachineSchema = z.object({ environment_id: z.string(), removed: z.literal(true) })
// 账 179：移除一台没连着的电脑（账 175 合并后旧配对的记录也在列表里）；连着的后端回 409
export function removeMachine(csrfToken: string, id: string, fetchImpl: Fetch = fetch) {
  return sendJson(
    removedMachineSchema,
    `/api/workbench/environments/${encodeURIComponent(id)}`,
    { csrfToken, method: 'DELETE' },
    fetchImpl,
  )
}
