// 专家处理中这一页的几条规则。纯函数。
import type { ConversationEvent, Now, Run, StepStatus } from '@/contracts/workbench-v2'

// 中间显示哪一步：用户点了哪一步就是哪一步；没点过，跟着专家走。
// 用户点过之后，专家做到下一步时页面不自己跳走（AT-INV-29）。
export function shownStep(run: Run | undefined, picked: number | null): number | null {
  if (!run || run.steps.length === 0) return null
  if (picked !== null && run.steps.some((step) => step.index === picked)) return picked
  return run.position?.step ?? run.steps[0].index
}

// 步骤轨上每种状态的记号
export const MARK: Record<StepStatus, string> = {
  pending: '○',
  running: '●',
  accepted: '✓',
  reworking: '↻',
  went_back: '↩',
  redo: '○',
  waiting: '⏸',
  failed: '✕',
  cancelled: '■',
  not_reached: '–',
}

// 答复要带的凭证，在「开了这件待办」的那条事件里
export function tokenOf(events: readonly ConversationEvent[], pending: string): string | null {
  for (let at = events.length - 1; at >= 0; at -= 1) {
    const event = events[at]
    if (event.type === 'interaction/opened' && event.payload.interaction_id === pending) {
      return typeof event.payload.token === 'string' ? event.payload.token : null
    }
  }
  return null
}

// 委托有没有变：这几种事件来了，对话是谁在处理可能变了
export function turningPoints(events: readonly ConversationEvent[]): number {
  return events.filter(
    (event) =>
      event.type === 'wheel/handover' ||
      event.type === 'wheel/return' ||
      event.type === 'task/state',
  ).length
}

// ---------------- 没有卡住 ----------------
// 只说真的：这一步做了多久、最近一次动静在多久之前、后台还握不握着沙箱。
// 没有「一般要多久」的统计，所以不说预计还要多久。
export type Reassurance = {
  elapsed: number // 这一步做了多少秒
  quiet: number // 最近一次动静在多少秒之前
  line: 'fresh' | 'quiet' | 'long' | 'unheld' | null
}

const seconds = (from: string | null, clock: number) =>
  from ? Math.max(0, Math.floor((clock - Date.parse(from)) / 1000)) : 0

export function reassurance(now: Now, clock: number): Reassurance {
  const elapsed = seconds(now.since, clock)
  const quiet = seconds(now.last_event_at, clock)
  const waiting = ['waiting', 'offline', 'supplying'].includes(now.doing.code)
  let line: Reassurance['line'] = null
  if (!waiting) {
    if (!now.held) line = 'unheld'
    else if (quiet < 20) line = 'fresh'
    else if (quiet < 90) line = 'quiet'
    else line = 'long'
  }
  return { elapsed, quiet, line }
}

// 「3 分 12 秒」。由页面按语言去说：这里只拆成分和秒
export function minutesAndSeconds(total: number) {
  return { minutes: Math.floor(total / 60), seconds: total % 60 }
}

// ---------------- 交回了什么 ----------------
// 交回物是专家包定的结构，各不相同。这里只按形状分：一张表、一串东西、一个值。
export type Shaped =
  | { kind: 'table'; key: string; columns: string[]; rows: unknown[][]; more: number }
  | { kind: 'list'; key: string; items: string[]; more: number }
  | { kind: 'value'; key: string; value: string }

const ROWS = 12
const COLUMNS = 8

function plain(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value === '' ? '—' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(plain).join('、')
  return JSON.stringify(value)
}

export function shape(content: unknown): Shaped[] {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return []
  const out: Shaped[] = []
  for (const [key, value] of Object.entries(content as Record<string, unknown>)) {
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((row) => row && typeof row === 'object' && !Array.isArray(row))
    ) {
      const columns = [...new Set(value.flatMap((row) => Object.keys(row as object)))].slice(
        0,
        COLUMNS,
      )
      out.push({
        kind: 'table',
        key,
        columns,
        rows: value
          .slice(0, ROWS)
          .map((row) => columns.map((column) => (row as Record<string, unknown>)[column])),
        more: Math.max(0, value.length - ROWS),
      })
    } else if (Array.isArray(value)) {
      out.push({
        kind: 'list',
        key,
        items: value.slice(0, ROWS).map(plain),
        more: Math.max(0, value.length - ROWS),
      })
    } else {
      out.push({ kind: 'value', key, value: plain(value) })
    }
  }
  return out
}

export { plain }
