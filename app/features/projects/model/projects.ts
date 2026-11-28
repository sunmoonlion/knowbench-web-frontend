// 项目清单与新建项目的规则。纯函数。
import type { Machine, Project, Workspace } from '@/contracts/workbench-v2'

// 项目列表：按工作区分组。组的先后跟着工作区的先后；组里最近用的在前
export type ProjectGroup = { workspace: Workspace; projects: Project[] }

export function byWorkspace(workspaces: Workspace[], projects: Project[]): ProjectGroup[] {
  const groups = workspaces.map((workspace) => ({
    workspace,
    projects: projects
      .filter(
        (project) =>
          project.environment_id === workspace.environment_id &&
          project.workspace_root === workspace.root,
      )
      .sort((a, b) => (b.last_active_at ?? '').localeCompare(a.last_active_at ?? '')),
  }))
  // 工作区已经从白名单里拿掉、但项目还在：另成一组，不让它们凭空消失
  const placed = new Set(groups.flatMap((group) => group.projects.map((project) => project.id)))
  const orphans = projects.filter((project) => !placed.has(project.id))
  for (const project of orphans) {
    const group = groups.find(
      (each) =>
        each.workspace.environment_id === project.environment_id &&
        each.workspace.root === project.workspace_root,
    )
    if (group) group.projects.push(project)
    else {
      groups.push({
        workspace: {
          environment_id: project.environment_id,
          environment_name: project.environment_name,
          online: project.online,
          root: project.workspace_root,
        },
        projects: [project],
      })
    }
  }
  return groups
}

// ---------------- 新建项目 ----------------
// 三步：选机器（只有一台就跳过）、选工作区、填子目录与名字
export function rootsOf(machines: Machine[], machine: string | null): string[] {
  return machines.find((each) => each.id === machine)?.roots ?? []
}

export function onlyMachine(machines: Machine[]): string | null {
  return machines.length === 1 ? machines[0].id : null
}

// 子目录是相对工作区的。不许往上走、不许是绝对路径
export type PathProblem = 'absolute' | 'upward' | 'invalid' | null

export function pathProblem(path: string): PathProblem {
  const cleaned = path.trim()
  if (!cleaned || cleaned === '.') return null
  if (/^[\\/~]|^[a-z]:[\\/]/i.test(cleaned)) return 'absolute'
  const parts = cleaned.replace(/\/+$/, '').split('/')
  if (cleaned.split(/[\\/]/).includes('..')) return 'upward'
  if (
    Array.from(cleaned).length > 400 ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part !== part.trim() ||
        part.endsWith('.') ||
        Array.from(part).length > 120 ||
        /[<>:"|?*\\]/.test(part) ||
        Array.from(part).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(part),
    )
  )
    return 'invalid'
  return null
}

// 没填名字时用什么：子目录的最后一段；连子目录也没填，就是工作区目录的最后一段
export function defaultTitle(root: string, path: string): string {
  const parts = `${root}/${path.trim()}`.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

// 分隔符跟着工作区的写法走（同后端 project_dir）：Windows 工作区用反斜杠，代理与工作台核的是同一串
export function fullDirectory(root: string, path: string): string {
  const cleaned = path.trim().replace(/^[\\/]+|[\\/]+$/g, '')
  if (!cleaned || cleaned === '.') return root
  if (/^[A-Za-z]:[\\/]|^\\\\/.test(root))
    return `${root.replace(/[\\/]+$/, '')}\\${cleaned.replace(/\//g, '\\')}`
  return `${root.replace(/\/+$/, '')}/${cleaned}`
}

// 拉取仓库时子目录默认用仓库名：地址最后一段去掉 .git
export function repoFolder(url: string): string {
  const last =
    url
      .trim()
      .replace(/[\\/]+$/, '')
      .split(/[\\/:]/)
      .pop() ?? ''
  return last.replace(/\.git$/i, '')
}
