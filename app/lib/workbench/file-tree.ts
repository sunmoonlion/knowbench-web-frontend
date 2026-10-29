// 文件树的纯函数（0022）：路径是用户电脑上的绝对路径，Windows 用反斜杠、别的用斜杠；分隔符看根长什么样。
import type { DirectoryEntry, LocalInfo } from '@/contracts/workbench-v2'

export function separatorOf(path: string): '\\' | '/' {
  return /^[A-Za-z]:\\/.test(path) || path.startsWith('\\\\') ? '\\' : '/'
}

export function childPath(parent: string, name: string): string {
  const sep = separatorOf(parent)
  return parent.endsWith(sep) ? parent + name : parent + sep + name
}

// 项目目录（绝对）+ 项目里的相对路径（正斜杠）→ 那台电脑上的绝对路径
export function underDirectory(directory: string, relative: string): string {
  const sep = separatorOf(directory)
  const tail = relative.split('/').filter(Boolean).join(sep)
  return directory.endsWith(sep) ? directory + tail : directory + sep + tail
}

export function baseName(path: string): string {
  const sep = separatorOf(path)
  const trimmed = path.endsWith(sep) && path.length > 1 ? path.slice(0, -1) : path
  const at = trimmed.lastIndexOf(sep)
  return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed
}

export function isUnder(path: string, root: string): boolean {
  const sep = separatorOf(root)
  const a = path.toLowerCase()
  const b = root.toLowerCase()
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep)
}

export type TreeRoot = { path: string }

// 树根 = 代理白名单里的目录；当前项目所在的那个根排最前。本地知识库目录随数据拓扑第四版①删了
// （0043 第 4.1 节）：用户的资料在 knowbase
export function treeRoots(info: Pick<LocalInfo, 'roots'>, directory: string | null): TreeRoot[] {
  const roots: TreeRoot[] = info.roots.map((path) => ({ path }))
  if (!directory) return roots
  return [...roots].sort(
    (x, y) => Number(isUnder(directory, y.path)) - Number(isUnder(directory, x.path)),
  )
}

// 从根到当前项目目录，一路要展开的目录
export function pathsToExpand(root: string, directory: string | null): string[] {
  if (!directory || !isUnder(directory, root)) return []
  const sep = separatorOf(root)
  const base = root.endsWith(sep) ? root.slice(0, -1) : root
  const rest = directory.slice(base.length).split(sep).filter(Boolean)
  const out: string[] = []
  let current = base
  for (const part of rest) {
    current = current + sep + part
    out.push(current)
  }
  return out
}

// 目录先、名字按本地规则排；`.git`、`node_modules` 这类排到最后
const HEAVY = new Set(['.git', 'node_modules', '__pycache__', '.venv', '.next'])
export function sortEntries(entries: readonly DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    const ha = HEAVY.has(a.name) ? 1 : 0
    const hb = HEAVY.has(b.name) ? 1 : 0
    if (ha !== hb) return ha - hb
    const da = a.type === 'dir' ? 0 : 1
    const db = b.type === 'dir' ? 0 : 1
    if (da !== db) return da - db
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}

// 前 8 KiB 里有 NUL 就当二进制；否则按 UTF-8 解
export function decodeText(bytes: Uint8Array): { text: string } | { binary: true } {
  const head = bytes.subarray(0, 8192)
  if (head.includes(0)) return { binary: true }
  return { text: new TextDecoder('utf-8').decode(bytes) }
}

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
