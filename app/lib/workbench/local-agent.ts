// 代理回环口的客户端（0022 乙案）：用户文件一个字节不出电脑。
// 网页先探 127.0.0.1:47811（占则 47812）上有没有代理，再向工作台要一张票，带着票直接敲代理。
// 工作台只发票，不碰文件；代理那头认 Origin 和票，白名单由它判。
import { z } from 'zod'

import {
  directorySchema,
  localInfoSchema,
  localSettingsSchema,
  localTicketSchema,
  type Directory,
  type LocalInfo,
  type LocalSettings,
  type LocalTicket,
} from '@/contracts/workbench-v2'

import { getJson, seg, sendJson, WorkbenchError } from './http'

// 五个候选口按顺序试：所有者机器上 47811 被 Cursor 编辑器占着（2026-10-12 实测），代理退到了 47812；再多备三个
export const LOCAL_PORTS = [47811, 47812, 47813, 47814, 47815] as const
const PROBE_TIMEOUT_MS = 2000
const TICKET_MARGIN_SECONDS = 60
export const MAX_READ_BYTES = 1024 * 1024

type Fetch = typeof fetch

// 浏览器从公网页面访问回环地址：Chrome 要这个字段（私有网络访问 / 本地网络访问）
const loopback = (init: RequestInit = {}): RequestInit =>
  ({ ...init, targetAddressSpace: 'loopback' }) as RequestInit

export class LocalAgentError extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(code)
    this.name = 'LocalAgentError'
  }
}

// 0.5.2 起本地 link 多报设备编号、主机名、系统和连接状态（账 143，会合点备忘第五节）；老版本没有这几项
export type LinkState =
  | 'connected'
  | 'connecting'
  | 'unreachable'
  | 'token_invalid'
  | 'replaced'
  | 'version_mismatch'
  | 'rejected'
export type Presence = {
  agent: string
  version: string
  machine_name: string
  connected: boolean
  device_id?: string
  host?: string
  os?: string
  link_state?: LinkState
}
const presenceSchema = z
  .object({
    agent: z.string(),
    version: z.string(),
    machine_name: z.string(),
    connected: z.boolean(),
    device_id: z.string().max(64).optional(),
    host: z.string().max(128).optional(),
    os: z.string().max(64).optional(),
    link_state: z
      .enum([
        'connected',
        'connecting',
        'unreachable',
        'token_invalid',
        'replaced',
        'version_mismatch',
        'rejected',
      ])
      .optional()
      .catch(undefined),
  })
  .loose()

// 这台电脑上有没有在运行的代理：有就回它在哪个口、叫什么。探不到不是错，是「没有」
export async function probeLocalAgent(
  fetchImpl: Fetch = fetch,
): Promise<{ port: number; presence: Presence } | null> {
  for (const port of LOCAL_PORTS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const response = await fetchImpl(
        `http://127.0.0.1:${port}/presence`,
        loopback({ signal: controller.signal, cache: 'no-store' }),
      )
      if (!response.ok) continue
      const parsed = presenceSchema.safeParse(await response.json().catch(() => null))
      // 别的程序也可能占着这个口（Cursor 就占过 47811）：只认自报家门是我们代理的
      if (parsed.success && parsed.data.agent === 'sunmoon-agent')
        return { port, presence: parsed.data }
    } catch {
      // 这个口没人听，试下一个
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

// 票按电脑缓存，到期前一分钟重取
const tickets = new Map<string, LocalTicket>()
export function forgetTicket(environment: string) {
  tickets.delete(environment)
}
export async function ticketFor(
  environment: string,
  fetchImpl: Fetch = fetch,
): Promise<LocalTicket> {
  const cached = tickets.get(environment)
  if (cached && cached.expires_at - TICKET_MARGIN_SECONDS > Date.now() / 1000) return cached
  const fresh = await getJson(
    localTicketSchema,
    `/api/workbench/environments/${seg(environment)}/local-ticket`,
    fetchImpl,
  )
  tickets.set(environment, fresh)
  return fresh
}

export type LocalAgent = { port: number; ticket: LocalTicket; info: LocalInfo }

// 探口 → 要票 → 问代理是谁。代理接的不是这个账号就说明白，不装作能看
export async function connectLocalAgent(
  environment: string,
  fetchImpl: Fetch = fetch,
): Promise<LocalAgent> {
  const found = await probeLocalAgent(fetchImpl)
  if (!found) throw new LocalAgentError('no_agent_here')
  const ticket = await ticketFor(environment, fetchImpl)
  const info = await localJson(localInfoSchema, found.port, ticket, '/local/v1/info', {}, fetchImpl)
  if (info.userId !== ticket.relay_user) throw new LocalAgentError('other_account')
  return { port: found.port, ticket, info }
}

async function localFetch(
  port: number,
  ticket: LocalTicket,
  path: string,
  init: RequestInit,
  fetchImpl: Fetch,
): Promise<Response> {
  let response: Response
  try {
    response = await fetchImpl(
      `http://127.0.0.1:${port}${path}`,
      loopback({
        ...init,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...init.headers,
          Authorization: `Bearer ${ticket.ticket}`,
        },
      }),
    )
  } catch {
    throw new LocalAgentError('no_agent_here')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: unknown } | null
    const code =
      typeof body?.code === 'string'
        ? body.code
        : response.status === 401
          ? 'ticket_invalid'
          : 'local_failed'
    throw new LocalAgentError(code, response.status)
  }
  return response
}

async function localJson<T>(
  schema: z.ZodType<T>,
  port: number,
  ticket: LocalTicket,
  path: string,
  init: RequestInit,
  fetchImpl: Fetch,
): Promise<T> {
  const response = await localFetch(port, ticket, path, init, fetchImpl)
  const parsed = schema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new LocalAgentError('contract_invalid', response.status)
  return parsed.data
}

export function readDirectory(
  agent: LocalAgent,
  path: string,
  fetchImpl: Fetch = fetch,
): Promise<Directory> {
  return localJson(
    directorySchema,
    agent.port,
    agent.ticket,
    `/local/v1/fs/dir?path=${encodeURIComponent(path)}`,
    {},
    fetchImpl,
  )
}

export type FileChunk = { bytes: Uint8Array; size: number; eof: boolean; mtime: number | null }

// 文件内容是原始字节，不是 base64；总长、是否读完在响应头里
export async function readFile(
  agent: LocalAgent,
  path: string,
  { offset = 0, length = MAX_READ_BYTES }: { offset?: number; length?: number } = {},
  fetchImpl: Fetch = fetch,
): Promise<FileChunk> {
  const response = await localFetch(
    agent.port,
    agent.ticket,
    `/local/v1/fs/file?path=${encodeURIComponent(path)}&offset=${offset}&length=${length}`,
    { headers: { Accept: 'application/octet-stream' } },
    fetchImpl,
  )
  const bytes = new Uint8Array(await response.arrayBuffer())
  const size = Number(response.headers.get('X-File-Size') ?? bytes.length)
  const mtimeHeader = response.headers.get('X-File-Mtime')
  return {
    bytes,
    size: Number.isFinite(size) ? size : bytes.length,
    eof: response.headers.get('X-File-Eof') !== 'false',
    mtime: mtimeHeader ? Number(mtimeHeader) : null,
  }
}

export function readSettings(agent: LocalAgent, fetchImpl: Fetch = fetch): Promise<LocalSettings> {
  return localJson(
    localSettingsSchema,
    agent.port,
    agent.ticket,
    '/local/v1/settings',
    {},
    fetchImpl,
  )
}

export type SettingsChange = {
  roots?: string[]
  rootChoices?: string[]
  ceiling?: { sandbox: string; network: boolean }
  autostart?: boolean
  libraryDir?: string | null
}

// 放宽的项代理会在那台电脑上弹窗问本人；这里只是把「想改成什么」送过去
export function writeSettings(
  agent: LocalAgent,
  change: SettingsChange,
  fetchImpl: Fetch = fetch,
): Promise<{ applied: boolean; restart?: boolean }> {
  return localJson(
    z.object({ applied: z.boolean(), restart: z.boolean().optional() }).loose(),
    agent.port,
    agent.ticket,
    '/local/v1/settings',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    },
    fetchImpl,
  )
}

// 新建项目（0024）：代理在工作区里建好文件夹、或拉好仓库，网页再去工作台登记。代理是 0.4.1 起才有这两个口
export const PROJECT_CAPABILITY = 'local-project-v1'
export const canMakeProjects = (agent: LocalAgent) =>
  (agent.info.capabilities ?? []).includes(PROJECT_CAPABILITY)

export function makeFolder(
  agent: LocalAgent,
  path: string,
  fetchImpl: Fetch = fetch,
): Promise<{ path: string; created: boolean }> {
  return localJson(
    z.object({ path: z.string(), created: z.boolean() }).loose(),
    agent.port,
    agent.ticket,
    '/local/v1/projects/folder',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    },
    fetchImpl,
  )
}

export type CloneAuth = { username?: string; token: string; remember?: boolean }

// 令牌只发往 127.0.0.1 上的代理，用这一次；不经工作台。拉大仓库要几分钟，取消就断开请求，代理那头停 git、删半截
export async function cloneRepository(
  agent: LocalAgent,
  request: { url: string; path: string; auth?: CloneAuth },
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch,
): Promise<{ path: string; branch: string | null }> {
  try {
    return await localJson(
      z.object({ path: z.string(), branch: z.string().nullable() }).loose(),
      agent.port,
      agent.ticket,
      '/local/v1/projects/clone',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      },
      fetchImpl,
    )
  } catch (error) {
    if (signal?.aborted) throw new LocalAgentError('cancelled')
    throw error
  }
}

// 工作台那头的错也可能到这里（要票时）：统一成一个 code 给页面挑话说
export function localProblemCode(error: unknown): string {
  if (error instanceof LocalAgentError) return error.code
  if (error instanceof WorkbenchError) return error.code
  return 'other'
}

export { sendJson }
