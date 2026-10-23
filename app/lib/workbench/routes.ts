// 工作台各页的地址（PRD/apps/investment.md 第四节）。页面与功能都从这里取，不自己拼。
import type { ConversationKind } from '@/contracts/workbench-v2'

export type Mode = 'chat' | 'work' | 'expert'
export const MODES: readonly Mode[] = ['chat', 'work', 'expert']
// 设置分三类（0021）：个人偏好 / 云端与模型 / 我的电脑
export const SETTINGS_SECTIONS = ['preferences', 'cloud', 'computer'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

function at(locale: string, ...parts: string[]) {
  return `/${[locale, 'workbench', ...parts].map(encodeURIComponent).join('/')}`
}

export const routes = {
  home: (locale: string, mode?: Mode) => (mode ? `${at(locale)}?mode=${mode}` : at(locale)),
  chat: (locale: string, conversation: string) => at(locale, 'chat', conversation),
  projects: (locale: string) => at(locale, 'projects'),
  project: (locale: string, project: string) => at(locale, 'projects', project),
  projectConversation: (locale: string, project: string, conversation: string) =>
    at(locale, 'projects', project, 'c', conversation),
  askExpert: (locale: string, project: string, from?: string) =>
    `${at(locale, 'projects', project, 'expert', 'new')}${from ? `?from=${encodeURIComponent(from)}` : ''}`,
  expert: (locale: string) => at(locale, 'expert'),
  machines: (locale: string) => at(locale, 'machines'),
  settings: (locale: string, section: SettingsSection = 'cloud') => at(locale, 'settings', section),
  // 接入电脑是第三类；旧的 settings#computer 由 SettingsRedirect 转过来
  computer: (locale: string) => at(locale, 'settings', 'computer'),
  // 云端知识库（SDD 0042）：上传的、代采的、买来的资料，真源在 knowbase
  library: (locale: string) => at(locale, 'library'),
  // 本地知识库（0019 §二，0022 乙案）：用户电脑上的那个目录，网页直连代理回环口翻看
  localLibrary: (locale: string) => at(locale, 'local-library'),
  // 长期记忆（0019 §四）
  memory: (locale: string) => at(locale, 'memory'),
}

// 一段对话在哪一页
export function conversationRoute(
  locale: string,
  conversation: { id: string; project_id: string | null; kind: ConversationKind },
) {
  return conversation.project_id === null
    ? routes.chat(locale, conversation.id)
    : routes.projectConversation(locale, conversation.project_id, conversation.id)
}

// 第 7 步是一页一页做的。还没做的页不给链接：不放点了没反应的东西。做好一页，在这里加一项。
export type Page =
  | 'home'
  | 'chat'
  | 'projects'
  | 'project'
  | 'projectConversation'
  | 'askExpert'
  | 'expert'
  | 'machines'
  | 'settings'
  | 'library'
  | 'localLibrary'
  | 'memory'

const BUILT: ReadonlySet<Page> = new Set([
  'home',
  'chat',
  'projects',
  'project',
  'projectConversation',
  'expert',
  'askExpert',
  'machines',
  'settings',
  'library',
  'localLibrary',
  'memory',
])

export function isBuilt(page: Page) {
  return BUILT.has(page)
}
