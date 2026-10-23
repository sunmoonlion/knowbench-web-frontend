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
  // Windows 上 Codex 命令隔离的模式：普通模式（unelevated）拦写不拦删，提示用户在托盘里提高（SDD 0041 第四节）
  windows_sandbox?: 'elevated' | 'unelevated'
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
    windows_sandbox: z.enum(['elevated', 'unelevated']).optional().catch(undefined),
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

// 浏览器不在装有本地 link 的电脑上（远程登录 link 的电脑，账 165、会合点备忘第十一节）：看文件、新建项目改走
// 工作台 → 会合点服务流 → 那台电脑上的本地 link。内容经云端转发、不落盘，页面要提醒。本地知识库目录不经这条路。
export type RemoteLink = {
  remote: true
  environment: string
  csrfToken: string
  info: LocalInfo
}
export type LinkHandle = LocalAgent | RemoteLink
export const isRemote = (link: LinkHandle): link is RemoteLink => 'remote' in link

const serviceHelloSchema = z
  .object({ roots: z.array(z.string()), capabilities: z.array(z.string()).optional() })
  .loose()
const SERVICE_PROJECTS = 'service-projects-v1'

export async function connectRemoteLink(
  environment: string,
  csrfToken: string,
  fetchImpl: Fetch = fetch,
): Promise<RemoteLink> {
  const hello = await getJson(
    serviceHelloSchema,
    `/api/workbench/environments/${seg(environment)}/service`,
    fetchImpl,
  )
  return {
    remote: true,
    environment,
    csrfToken,
    info: {
      userId: `remote:${environment}`,
      roots: hello.roots,
      libraryDir: null,
      // 0.5.2 起本地 link 的服务流能新建项目；老版本只能看
      capabilities: (hello.capabilities ?? []).includes(SERVICE_PROJECTS)
        ? [PROJECT_CAPABILITY]
        : [],
    },
  }
}

// 这台是装有本地 link 的电脑就直连回环口；探到的本地 link 不是这个账号的、或这台根本没有，就走远程（账 165）
export async function connectLink(
  environment: string,
  side: 'local' | 'remote' | 'try-local',
  csrfToken: string,
  fetchImpl: Fetch = fetch,
): Promise<LinkHandle> {
  if (side === 'remote') return connectRemoteLink(environment, csrfToken, fetchImpl)
  try {
    return await connectLocalAgent(environment, fetchImpl)
  } catch (error) {
    if (error instanceof LocalAgentError && ['no_agent_here', 'other_account'].includes(error.code))
      return connectRemoteLink(environment, csrfToken, fetchImpl)
    throw error
  }
}

const remoteBase = (link: RemoteLink) =>
  `/api/workbench/environments/${seg(link.environment)}/remote`
const remoteFileSchema = z
  .object({
    content: z.string(),
    size: z.number(),
    mtime: z.number().nullable().optional(),
    eof: z.boolean(),
  })
  .loose()
const remoteDirectorySchema = z
  .object({ entries: directorySchema.shape.entries, truncated: z.boolean().optional() })
  .loose()

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

export async function readDirectory(
  agent: LinkHandle,
  path: string,
  fetchImpl: Fetch = fetch,
): Promise<Directory> {
  if (isRemote(agent)) {
    const listed = await getJson(
      remoteDirectorySchema,
      `${remoteBase(agent)}/fs/dir?path=${encodeURIComponent(path)}`,
      fetchImpl,
    )
    return { path, entries: listed.entries, truncated: listed.truncated }
  }
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
  agent: LinkHandle,
  path: string,
  { offset = 0, length = MAX_READ_BYTES }: { offset?: number; length?: number } = {},
  fetchImpl: Fetch = fetch,
): Promise<FileChunk> {
  if (isRemote(agent)) {
    // 服务流里是 base64（和本地 link 的 fs/readFile 一样）
    const chunk = await getJson(
      remoteFileSchema,
      `${remoteBase(agent)}/fs/file?path=${encodeURIComponent(path)}&offset=${offset}&length=${length}`,
      fetchImpl,
    )
    const bytes = Uint8Array.from(atob(chunk.content), (c) => c.charCodeAt(0))
    return { bytes, size: chunk.size, eof: chunk.eof, mtime: chunk.mtime ?? null }
  }
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
export const canMakeProjects = (agent: LinkHandle) =>
  (agent.info.capabilities ?? []).includes(PROJECT_CAPABILITY)

export function makeFolder(
  agent: LinkHandle,
  path: string,
  fetchImpl: Fetch = fetch,
): Promise<{ path: string; created: boolean }> {
  const schema = z.object({ path: z.string(), created: z.boolean() }).loose()
  if (isRemote(agent))
    return sendJson(
      schema,
      `${remoteBase(agent)}/projects/folder`,
      { csrfToken: agent.csrfToken, body: { path } },
      fetchImpl,
    )
  return localJson(
    schema,
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

// 装有本地 link 的电脑上：令牌只发往 127.0.0.1 上的本地 link，用这一次，不经工作台。远程登录 link 的电脑上：先不带令牌
// （用那台电脑上 git 现有的登录）；要令牌时经工作台转发、不落盘，页面先提醒（账 165）。拉大仓库要几分钟，取消就断开请求：
// 回环口那头本地 link 停 git、删半截；远程时只是不再等，那台电脑上可能还在拉
export async function cloneRepository(
  agent: LinkHandle,
  request: { url: string; path: string; auth?: CloneAuth },
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch,
): Promise<{ path: string; branch: string | null }> {
  const schema = z.object({ path: z.string(), branch: z.string().nullable() }).loose()
  try {
    if (isRemote(agent))
      return await sendJson(
        schema,
        `${remoteBase(agent)}/projects/clone`,
        { csrfToken: agent.csrfToken, body: request, signal },
        fetchImpl,
      )
    return await localJson(
      schema,
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
