// 侧栏里有什么、指到哪。纯函数：数据进来，要显示的东西出去。
import type { Conversation, Machine, Project, Workspace } from '@/contracts/workbench-v2'
import { conversationRoute, isBuilt, routes, type Mode, type Page } from '@/lib/workbench/routes'

// ---------------- 当前在哪个功能 ----------------
export function modeOf(pathname: string, search: string, conversation?: Conversation): Mode {
  const rest = pathname.split('/workbench')[1] ?? ''
  if (rest.startsWith('/expert') || /\/expert\/new$/.test(rest) || /\/tasks\//.test(rest)) {
    return 'expert'
  }
  if (rest.startsWith('/chat/')) return 'chat'
  // 专家正拿着这段对话：现在看的是专家
  if (conversation?.wheel === 'advisor') return 'expert'
  if (conversation) return conversation.kind
  const asked = new URLSearchParams(search).get('mode')
  return asked === 'work' || asked === 'expert' ? asked : 'chat'
}

// ---------------- 工作区与项目 ----------------
export function workspaceKey(workspace: { environment_id: string; root: string }) {
  return `${workspace.environment_id}\n${workspace.root}`
}

export function projectsIn(projects: Project[], workspace: Workspace | undefined) {
  if (!workspace) return []
  return projects
    .filter(
      (project) =>
        !project.archived &&
        project.environment_id === workspace.environment_id &&
        project.workspace_root === workspace.root,
    )
    .sort((a, b) => (b.last_active_at ?? '').localeCompare(a.last_active_at ?? ''))
}

// 没选过的时候：最近用过的项目所在的那个工作区；一个项目都没有，就第一个
export function defaultWorkspace(workspaces: Workspace[], projects: Project[]) {
  const latest = [...projects]
    .filter((project) => !project.archived)
    .sort((a, b) => (b.last_active_at ?? '').localeCompare(a.last_active_at ?? ''))[0]
  const home = latest
    ? workspaces.find(
        (w) => w.environment_id === latest.environment_id && w.root === latest.workspace_root,
      )
    : undefined
  return home ?? workspaces[0]
}

// ---------------- 最近的对话 ----------------
export type RecentItem = {
  id: string
  title: string | null
  kind: Conversation['kind']
  busy: boolean // 专家正在这段对话里做事
  project: string | null
  href: string | null
}

export function recent(
  conversations: Conversation[],
  projects: Project[],
  locale: string,
  limit = 8,
): RecentItem[] {
  const names = new Map(projects.map((project) => [project.id, project.title]))
  return (
    [...conversations]
      // 项目已从工作台移除（归档）的对话不再算「最近」
      .filter((conversation) => !conversation.project_id || names.has(conversation.project_id))
      .sort((a, b) =>
        (b.last_active_at ?? b.created_at).localeCompare(a.last_active_at ?? a.created_at),
      )
      .slice(0, limit)
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        kind: conversation.kind,
        busy: conversation.wheel === 'advisor',
        project: conversation.project_id ? (names.get(conversation.project_id) ?? null) : null,
        href: isBuilt(conversation.project_id === null ? 'chat' : 'projectConversation')
          ? conversationRoute(locale, conversation)
          : null,
      }))
  )
}

// ---------------- 按真源分层的树：电脑 → 工作区 → 项目 → 对话（0016）----------------
export type TreeConversation = {
  id: string
  title: string | null
  kind: Conversation['kind']
  busy: boolean
  href: string
}
export type TreeProject = {
  project: Project
  busy: boolean // 专家正在这个项目的某段对话里做事
  conversations: TreeConversation[]
}
export type TreeWorkspace = { key: string; root: string; online: boolean; projects: TreeProject[] }
export type TreeMachine = {
  id: string
  name: string
  status: string
  workspaces: TreeWorkspace[]
}

export function computerTree(
  machines: Machine[],
  workspaces: Workspace[],
  projects: Project[],
  conversations: Conversation[],
  locale: string,
): TreeMachine[] {
  const byProject = new Map<string, TreeConversation[]>()
  for (const conversation of [...conversations].sort((a, b) =>
    (b.last_active_at ?? b.created_at).localeCompare(a.last_active_at ?? a.created_at),
  )) {
    if (!conversation.project_id) continue
    const list = byProject.get(conversation.project_id) ?? []
    list.push({
      id: conversation.id,
      title: conversation.title,
      kind: conversation.kind,
      busy: conversation.wheel === 'advisor',
      href: conversationRoute(locale, conversation),
    })
    byProject.set(conversation.project_id, list)
  }
  return machines.map((machine) => ({
    id: machine.id,
    name: machine.name,
    status: machine.status,
    workspaces: workspaces
      .filter((workspace) => workspace.environment_id === machine.id)
      .map((workspace) => ({
        key: workspaceKey(workspace),
        root: workspace.root,
        online: workspace.online,
        projects: projectsIn(projects, workspace).map((project) => {
          const list = byProject.get(project.id) ?? []
          return { project, busy: list.some((c) => c.busy), conversations: list }
        }),
      })),
  }))
}

// 没归入项目的聊天：挂在树下面单独一节（0017：聊天新建时什么都不选）
export function looseChats(conversations: Conversation[], locale: string): TreeConversation[] {
  return [...conversations]
    .filter((conversation) => conversation.project_id === null)
    .sort((a, b) =>
      (b.last_active_at ?? b.created_at).localeCompare(a.last_active_at ?? a.created_at),
    )
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      kind: conversation.kind,
      busy: conversation.wheel === 'advisor',
      href: conversationRoute(locale, conversation),
    }))
}

// ---------------- 我的机器 ----------------
export type MachineLight = 'online' | 'offline' | 'none'

export function machineLight(machines: Machine[]): MachineLight {
  if (!machines.length) return 'none'
  return machines.some((machine) => machine.status === 'online') ? 'online' : 'offline'
}

// ---------------- 侧栏底部的条目 ----------------
// 由这份清单生成。以后加「技能」「连接器」「助理」，只在这里加一项（PRD investment.md 11.3）。
// 公共数据的入口（数据目录、申请入库）不在用户侧，放管理后台（所有者 2026-10-07 定）。
export type FootEntry = { key: string; kind: 'page'; page: Page; href: (locale: string) => string }

export const FOOT: readonly FootEntry[] = [
  { key: 'pending', kind: 'page', page: 'home', href: (locale) => routes.home(locale) },
  // 本地知识库：用户电脑上的目录，网页直连代理回环口翻看（0019 §二、0022 乙案）
  { key: 'localLibrary', kind: 'page', page: 'localLibrary', href: routes.localLibrary },
  // 知识库（0011）：等账 85 撤
  { key: 'library', kind: 'page', page: 'library', href: routes.library },
  // 长期记忆：关于这位用户的几条事实（0019 §四）
  { key: 'memory', kind: 'page', page: 'memory', href: routes.memory },
  // 「我的电脑」不再单列：灯在中段的电脑行上，接入与上限在设置页（0016 S2）
  { key: 'settings', kind: 'page', page: 'settings', href: routes.settings },
]

export function footHref(entry: FootEntry, locale: string): string | null {
  return isBuilt(entry.page) ? entry.href(locale) : null
}

// ---------------- 「待我决定」的指针表（0016 S3）：哪个项目、哪段对话、哪一步、还剩多少分钟 ----------------
// 工具级审批与模型提问挂着时 Codex 那一轮在等，一小时就停，算「急」；验收失败与预算可以放几天
export type PendingPointer = {
  id: string
  urgent: boolean
  about: string
  project: string | null
  conversation: string | null
  step: string | null
  minutesLeft: number | null
  href: string | null
}

// 首页清单与侧栏弹层拿到的行形状略有不同，只用到这几样
export type PendingLike = {
  interaction_id: string
  kind: string
  expires_at?: string | null
  where: {
    about?: string | null
    project?: { id: string; title: string | null } | null
    conversation?: { id: string; title: string | null; kind: Conversation['kind'] } | null
    step?: { index: number; title: string } | null
  }
}

export function pendingPointers(
  rows: PendingLike[],
  locale: string,
  now: number = Date.now(),
): PendingPointer[] {
  return rows
    .map((row) => {
      const where = row.where
      const expires = row.expires_at ? Date.parse(row.expires_at) : NaN
      return {
        id: row.interaction_id,
        urgent: row.kind === 'tool_approval' || row.kind === 'question',
        about: where.about ?? row.kind,
        project: where.project?.title ?? null,
        conversation: where.conversation?.title ?? null,
        step: where.step ? `${where.step.index}. ${where.step.title}` : null,
        minutesLeft: Number.isNaN(expires)
          ? null
          : Math.max(0, Math.round((expires - now) / 60000)),
        href: where.conversation
          ? conversationRoute(locale, {
              id: where.conversation.id,
              project_id: where.project?.id ?? null,
              kind: where.conversation.kind,
            })
          : null,
      }
    })
    .sort((a, b) => Number(b.urgent) - Number(a.urgent))
}

// ---------------- 「这台电脑还没接入 / 就是这台 / 连在别的账号上」（账 92）：网页探本机回环口得到的结果和账号下的电脑对一对 ----------------
// elsewhere：本机代理连着会合点，账号下同名的电脑却不在线——代理配在别的账号上（同一台电脑在两个账号下各有一条，只按名字比会误报「就是这台」）
export type PresenceHint = { thisOne: string | null; elsewhere: string | null; notHere: boolean }
const NO_HINT: PresenceHint = { thisOne: null, elsewhere: null, notHere: false }
// presence 为 undefined = 还没探；null = 探过了，这台电脑上没有在跑的代理
export function presenceHint(
  machines: readonly { name: string; status: string }[],
  presence: { machine_name: string; connected: boolean } | null | undefined,
): PresenceHint {
  if (presence === undefined || machines.length === 0) return NO_HINT
  if (presence === null) return { ...NO_HINT, notHere: true }
  const same = machines.filter((machine) => machine.name === presence.machine_name)
  // 探到了代理但名字对不上账号下的电脑：多半是别的账号的代理，也算「这台还没接入」
  if (same.length === 0) return { ...NO_HINT, notHere: true }
  if (presence.connected && !same.some((machine) => machine.status === 'online')) {
    return { ...NO_HINT, elsewhere: presence.machine_name }
  }
  return { ...NO_HINT, thisOne: presence.machine_name }
}
