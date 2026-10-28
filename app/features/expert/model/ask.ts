// 「请专家」这一页的规则。纯函数。
import type { Pack, ProjectDetail } from '@/contracts/workbench-v2'

// 交不出去的原因。页面按这个词去说
export type AskBlocker =
  | 'noExpert' // 还没选哪位专家
  | 'noQuestion'
  | 'noSandbox'
  | 'noMachine'
  | 'offline' // 项目所在的机器不在线：专家要在上面干活
  | 'busy' // 这个项目里有一件事专家还在做

export function askBlocker(input: {
  pack: Pack | undefined
  question: string
  project: ProjectDetail | undefined
  sandboxes: number | undefined
  machines?: number
}): AskBlocker | null {
  const { pack, question, project, sandboxes } = input
  if (input.machines === 0) return 'noMachine'
  if (sandboxes === 0) return 'noSandbox'
  if (project && !project.project.online) return 'offline'
  if (project?.active_task_id) return 'busy'
  if (!pack) return 'noExpert'
  if (!question.trim()) return 'noQuestion'
  return null
}

// 专家正在做的那件事在哪段对话里
export function busyConversation(project: ProjectDetail | undefined): string | null {
  return project?.conversations.find((each) => each.active_task_id !== null)?.id ?? null
}

// 专家看得到什么。只数数量，不列内容
export function sees(project: ProjectDetail | undefined, from: string | null) {
  const others = (project?.conversations ?? []).filter((each) => each.id !== from).length
  return { conversations: others, dossiers: project?.tasks.length ?? 0 }
}
