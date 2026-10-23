// Codex 的一件事（一次查数据、一条命令、一次改文件）→ 页面上的一行。纯函数。
// 聊天页和工作页都要用，所以放在公共的地方。

export type DataStep = {
  kind: 'data'
  id: string
  server: string
  tool: string
  dataset: string | null
  version: string | null
  failed: boolean
  running: boolean
  query: string
  result: string
}

export type CommandStep = {
  kind: 'file'
  id: string
  // 读文件时是文件名；别的命令是命令本身
  label: string
  reading: boolean
  running: boolean
  failed: boolean
  exitCode: number | null
  command: string
  output: string
}

export type ChangedFile = {
  path: string
  how: 'add' | 'update' | 'delete'
  added: number
  removed: number
  diff: string
}

export type ChangeStep = {
  kind: 'change'
  id: string
  files: ChangedFile[]
  running: boolean
  // 没改成：失败了，或者用户没同意
  failed: boolean
}

export type Item = Record<string, unknown>

export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function pretty(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// 工具答复里的正文：MCP 的答复是若干段文字
function resultText(result: unknown): string {
  if (!result || typeof result !== 'object') return pretty(result)
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return pretty(result)
  return content
    .map((part) => (part && typeof part === 'object' ? text((part as Item).text) : ''))
    .filter(Boolean)
    .join('\n')
}

function versionIn(result: string): string | null {
  const found = /"data_version"\s*:\s*"([^"]+)"/.exec(result)
  return found ? found[1] : null
}

// 工具调用的通用样子：哪个服务、哪个工具、参数、结果。我们自己的数据工具再认出数据集与版本
export function dataStep(item: Item, running: boolean): DataStep {
  const args = (item.arguments ?? {}) as Item
  const result = resultText(item.result)
  return {
    kind: 'data',
    id: text(item.id),
    server: text(item.server),
    tool: text(item.tool),
    dataset: text(args.dataset) || null,
    version: versionIn(result),
    failed: !running && (item.status === 'failed' || Boolean(item.error)),
    running,
    query: pretty(item.arguments),
    result: result || pretty(item.error),
  }
}

export function commandStep(item: Item, running: boolean): CommandStep {
  const actions = Array.isArray(item.commandActions) ? (item.commandActions as Item[]) : []
  const first = actions[0] ?? {}
  const reading = actions.length > 0 && actions.every((action) => action.type === 'read')
  const command = text(first.command) || text(item.command)
  const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
  return {
    kind: 'file',
    id: text(item.id),
    label: reading ? actions.map((action) => text(action.name)).join('、') : command,
    reading,
    running,
    failed: !running && exitCode !== null && exitCode !== 0,
    exitCode,
    command,
    output: text(item.aggregatedOutput),
  }
}

function countLines(diff: string) {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

// 新建、删除的文件，Codex 给的是整份内容、不是补丁：Markdown 里「- 」开头的列表行会被当成
// 删掉的行，新建的成稿显示成「+0 −38」（账 147）。按整份内容数行，前面补上 + 或 −，和补丁一样
// 显示。已经是一行一个 + 或 − 的（照补丁写的）原样用。
function wholeFile(how: 'add' | 'delete', content: string) {
  const sign = how === 'add' ? '+' : '-'
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n')
  if (lines.length > 0 && lines.every((line) => line.startsWith(sign))) {
    return {
      diff: content,
      added: how === 'add' ? lines.length : 0,
      removed: how === 'add' ? 0 : lines.length,
    }
  }
  return {
    diff: lines.map((line) => sign + line).join('\n'),
    added: how === 'add' ? lines.length : 0,
    removed: how === 'add' ? 0 : lines.length,
  }
}

// 用补丁改文件（Codex 的 fileChange）。命令行里改的文件不在这里：那种改动 Codex 不单独报
export function changeStep(item: Item, running: boolean): ChangeStep {
  const changes = Array.isArray(item.changes) ? (item.changes as Item[]) : []
  return {
    kind: 'change',
    id: text(item.id),
    running,
    failed: !running && (item.status === 'failed' || item.status === 'declined'),
    files: changes.map((change) => {
      const kind = text((change.kind as Item | undefined)?.type)
      const how = kind === 'add' || kind === 'delete' ? kind : 'update'
      const diff = text(change.diff)
      return {
        path: text(change.path),
        how,
        ...(how === 'update' ? { diff, ...countLines(diff) } : wholeFile(how, diff)),
      }
    }),
  }
}

export function turnIdOf(payload: Item): string | null {
  const turn = payload.turn as Item | undefined
  return text(payload.turnId) || text(turn?.id) || null
}

// 路径写成相对项目目录的：页面上不用每行都带一长串
export function relativeTo(directory: string | null | undefined, path: string): string {
  if (!directory) return path
  const base = directory.endsWith('/') ? directory : `${directory}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}
