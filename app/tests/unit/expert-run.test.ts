import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { conversationEventSchema, runSchema, type Now } from '@/contracts/workbench-v2'
import {
  minutesAndSeconds,
  reassurance,
  shape,
  shownStep,
  tokenOf,
  turningPoints,
} from '@/features/expert/model/run'

const full = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as {
  pages: { title: string; path: string }[]
  responses: { method: string; path: string; query: string; file: string }[]
}
const read = (path: string, query = '') =>
  JSON.parse(
    readFileSync(
      join(full, manifest.responses.find((r) => r.path === path && r.query === query)!.file),
      'utf8',
    ),
  )
const conversationOf = (title: string) =>
  manifest.pages
    .find((p) => p.title.startsWith(title))!
    .path.split('/')
    .pop()!
const taskOf = (title: string) =>
  read('/api/workbench/tasks', `session_id=${conversationOf(title)}`).tasks[0].id as string

describe('专家处理中', () => {
  const running = runSchema.parse(read(`/api/workbench/tasks/${taskOf('专家处理中')}/steps`))

  it('中间显示哪一步：没点过就跟着专家走，点过就不自己跳', () => {
    expect(shownStep(running, null)).toBe(3)
    expect(shownStep(running, 1)).toBe(1)
    // 专家做到了下一步：用户点的那一步不变
    const later = { ...running, position: { ...running.position!, step: 4 } }
    expect(shownStep(later, 1)).toBe(1)
    expect(shownStep(later, null)).toBe(4)
    expect(shownStep(undefined, 2)).toBeNull()
    expect(shownStep(running, 99)).toBe(3)
  })

  it('现在在干什么、为什么：话是后端给的', () => {
    expect(running.now?.step).toMatchObject({ index: 3, of: 5, title: '执行 SQL' })
    expect(running.now?.step.why).toContain('原样带回')
    expect(running.now?.doing.text).toBeTruthy()
  })

  it('答复用的凭证从事件里找', () => {
    const conversation = conversationOf('专家停下来了：勾稽不平')
    const events = (
      read(`/api/workbench/sessions/${conversation}/events`, 'limit=1000').events as unknown[]
    ).map((event) => conversationEventSchema.parse(event))
    const run = runSchema.parse(
      read(`/api/workbench/tasks/${taskOf('专家停下来了：勾稽不平')}/steps`),
    )
    const pending = run.task.active_interaction_id!
    expect(tokenOf(events, pending)?.length).toBeGreaterThan(16)
    expect(tokenOf(events, '00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(turningPoints(events)).toBeGreaterThan(0)
    expect(run.now?.doing.code).toBe('waiting')
  })
})

describe('没有卡住：只说真的', () => {
  const at = Date.parse('2026-10-04T00:10:00Z')
  const now = (more: Partial<Now>): Now => ({
    step: { index: 1, of: 2, title: 't', summary: 's', why: 'w' },
    doing: { code: 'thinking', text: '在想' },
    redo: null,
    since: '2026-10-04T00:08:00Z',
    last_event_at: '2026-10-04T00:09:55Z',
    held: true,
    ...more,
  })
  it('按最近一次动静在多久之前分三档', () => {
    expect(reassurance(now({}), at)).toEqual({ elapsed: 120, quiet: 5, line: 'fresh' })
    expect(reassurance(now({ last_event_at: '2026-10-04T00:09:20Z' }), at).line).toBe('quiet')
    expect(reassurance(now({ last_event_at: '2026-10-04T00:08:00Z' }), at).line).toBe('long')
  })
  it('后台没有握着沙箱：如实说，不说「还在进行」', () => {
    expect(reassurance(now({ held: false }), at).line).toBe('unheld')
  })
  it('停下来等你的时候不用安慰', () => {
    const waiting = now({ doing: { code: 'waiting', text: '停下来了' }, held: false })
    expect(reassurance(waiting, at).line).toBeNull()
  })
  it('已确认的补采等待不误报沙箱掉线', () => {
    const supplying = now({ doing: { code: 'supplying', text: '正在取数' }, held: false })
    expect(reassurance(supplying, at).line).toBeNull()
  })
  it('时间的写法', () => {
    expect(minutesAndSeconds(192)).toEqual({ minutes: 3, seconds: 12 })
    expect(minutesAndSeconds(8)).toEqual({ minutes: 0, seconds: 8 })
  })
})

describe('交回了什么：按形状摆', () => {
  it('一张表、一串东西、一个值', () => {
    const shaped = shape({
      checks: [
        { rule: '资产 = 负债 + 所有者权益', unbalanced: 0 },
        { rule: '净利润勾稽', unbalanced: 1, note: 'x' },
      ],
      unexplained_breaks: [],
      notes: ['甲', '乙'],
      data_version: 'v1',
      nested: { a: 1 },
    })
    expect(shaped[0]).toEqual({
      kind: 'table',
      key: 'checks',
      columns: ['rule', 'unbalanced', 'note'],
      rows: [
        ['资产 = 负债 + 所有者权益', 0, undefined],
        ['净利润勾稽', 1, 'x'],
      ],
      more: 0,
    })
    expect(shaped[1]).toEqual({ kind: 'list', key: 'unexplained_breaks', items: [], more: 0 })
    expect(shaped[2]).toEqual({ kind: 'list', key: 'notes', items: ['甲', '乙'], more: 0 })
    expect(shaped[3]).toEqual({ kind: 'value', key: 'data_version', value: 'v1' })
    expect(shaped[4]).toEqual({ kind: 'value', key: 'nested', value: '{"a":1}' })
    expect(shape(null)).toEqual([])
    expect(shape('文字')).toEqual([])
  })
  it('长表只摆前面几行，说明还有多少', () => {
    const rows = Array.from({ length: 30 }, (_, n) => ({ n }))
    const [table] = shape({ rows })
    expect(table.kind === 'table' && [table.rows.length, table.more]).toEqual([12, 18])
  })
})

describe('请专家：现在能不能交出去', () => {
  // 懒得再引一遍：这一段只用到下面两个函数
  it('一条一条拦', async () => {
    const { askBlocker, findBlocker, busyConversation, sees } =
      await import('@/features/expert/model/ask')
    const { packsSchema, projectDetailSchema } = await import('@/contracts/workbench-v2')
    const packs = packsSchema.parse(read('/api/workbench/packs')).packs
    const title = (start: string) =>
      manifest.pages.find((p) => p.title.startsWith(start))!.path.split('/')
    const free = projectDetailSchema.parse(read(`/api/workbench/projects/${title('项目页')[4]}`))
    const busy = projectDetailSchema.parse(
      read(`/api/workbench/projects/${title('专家处理中')[4]}`),
    )
    const ok = { pack: packs[0], question: '问', project: free, sandboxes: 1 }
    expect(askBlocker(ok)).toBeNull()
    expect(askBlocker({ ...ok, pack: undefined })).toBe('noExpert')
    expect(askBlocker({ ...ok, question: ' ' })).toBe('noQuestion')
    expect(askBlocker({ ...ok, sandboxes: 0 })).toBe('noSandbox')
    expect(askBlocker({ ...ok, project: busy })).toBeNull()
    expect(findBlocker({ ...ok, project: busy })).toBeNull()
    expect(
      askBlocker({ ...ok, project: { ...free, project: { ...free.project, online: false } } }),
    ).toBe('offline')
    // 专家在哪段对话里做：给一条过去的路
    expect(busyConversation(busy)).toBe(title('专家处理中')[6])
    expect(busyConversation(free)).toBeNull()
    // 专家看得到：项目里别的几段对话、几份底稿。只数数
    expect(sees(free, null)).toEqual({ conversations: 3, dossiers: 1 })
    expect(sees(free, free.conversations[0].id)).toEqual({ conversations: 2, dossiers: 1 })
  })
})
