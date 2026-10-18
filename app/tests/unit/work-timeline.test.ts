import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { conversationEventSchema, type ConversationEvent } from '@/contracts/workbench-v2'
import { byFile, liveDetail, phaseTally, timeline } from '@/features/work/model/timeline'
import { relativeTo } from '@/lib/workbench/items'

const full = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as {
  pages: { title: string; path: string }[]
  responses: { method: string; path: string; file: string }[]
}

// 样例里的那段工作：第一轮是真 Codex 录的（看目录、读文件、写文件），
// 第二轮是照协议拼的（用补丁改文件），第三轮是录的（一条命令停在等批准）
function work(): ConversationEvent[] {
  const page = manifest.pages.find((each) => each.title.startsWith('工作（'))!
  const id = page.path.split('/').pop()!
  const found = manifest.responses.find(
    (each) => each.path === `/api/workbench/sessions/${id}/events`,
  )!
  const body = JSON.parse(readFileSync(join(full, found.file), 'utf8')) as { events: unknown[] }
  return body.events.map((event) => conversationEventSchema.parse(event))
}

describe('工作页的时间线', () => {
  const all = work()
  const line = timeline(all)

  it('三句话、三段过程、一次改文件、一件等批准的事', () => {
    expect(line.entries.filter((entry) => entry.kind === 'user')).toHaveLength(3)
    const phases = line.entries.filter((entry) => entry.kind === 'phase')
    // 它先说一句要做什么，再动手：那句话成了这一段的标题，不再单独占一行
    expect(phases[0]).toMatchObject({ said: '我先看一下当前目录结构，然后创建这个说明文件。' })
    expect(phases[0].kind === 'phase' && phases[0].steps).toHaveLength(2)
    expect(phases.map((phase) => phase.kind === 'phase' && phase.steps.length)).toEqual([2, 1, 1])
    expect(phaseTally(phases[0].kind === 'phase' ? phases[0].steps : [])).toEqual({
      commands: 2,
      data: 0,
      failed: 0,
      running: false,
    })
    // 模型的思考不进时间线
    expect(JSON.stringify(line.entries)).not.toContain('The user wants')
  })

  it('最后的回答是单独的一条，不被当成过程的标题', () => {
    const models = line.entries.filter((entry) => entry.kind === 'model')
    expect(models.some((entry) => entry.kind === 'model' && entry.text.startsWith('已创建'))).toBe(
      true,
    )
    expect(models.some((entry) => entry.kind === 'model' && entry.text.startsWith('改好了'))).toBe(
      true,
    )
  })

  it('用补丁改的文件：摆在外面，也进「改动」栏', () => {
    const change = line.entries.find((entry) => entry.kind === 'change')
    expect(change?.kind === 'change' && change.step.files.map((file) => file.how)).toEqual([
      'update',
      'add',
    ])
    const files = byFile(line.changes)
    expect(files.map((file) => relativeTo('/home/demo/research/恒瑞医药', file.path))).toEqual([
      'README.md',
      'notes/待办.md',
    ])
    expect(files[0]).toMatchObject({ how: 'update', added: 2, removed: 1 })
    expect(files[1]).toMatchObject({ how: 'add', added: 4, removed: 0 })
  })

  it('等批准的命令：一张卡，带着答复用的凭证；这时候它在等你', () => {
    const waiting = line.entries.filter((entry) => entry.kind === 'approval')
    expect(waiting).toHaveLength(1)
    const approval = waiting[0].kind === 'approval' ? waiting[0].approval : null
    expect(approval).toMatchObject({ state: 'pending', cwd: '/home/demo/research/恒瑞医药' })
    expect(approval?.command).toContain('outside.txt')
    expect(approval?.token.length).toBeGreaterThan(16)
    expect(line.live).toBe('approval')
    // 那条命令在最后一段过程里，还在等
    const phases = line.entries.filter((entry) => entry.kind === 'phase')
    const lastPhase = phases[phases.length - 1]
    expect(lastPhase.kind === 'phase' && lastPhase.steps[0].running).toBe(true)
  })

  it('答复之后：卡片记下你答了什么，它接着做', () => {
    const opened = all.find((event) => event.type === 'interaction/opened')!
    const answered = conversationEventSchema.parse({
      ...opened,
      id: '00000000-0000-4000-8000-000000009999',
      cursor: all[all.length - 1].cursor + 1,
      type: 'interaction/consumed',
      payload: {
        interaction_id: opened.payload.interaction_id,
        kind: 'tool_approval',
        response: { decision: 'decline' },
      },
    })
    const after = timeline([...all, answered])
    const card = after.entries.find((entry) => entry.kind === 'approval')
    expect(card?.kind === 'approval' && card.approval).toMatchObject({
      state: 'answered',
      decision: 'decline',
    })
    expect(after.live).toBe('thinking')
  })

  it('专家拿着方向盘的那一段：过程照常摆，每一步交回的 JSON 原样不摆', () => {
    const page = manifest.pages.find((each) => each.title.startsWith('专家处理中'))!
    const id = page.path.split('/').pop()!
    const found = manifest.responses.find(
      (each) => each.path === `/api/workbench/sessions/${id}/events`,
    )!
    const body = JSON.parse(readFileSync(join(full, found.file), 'utf8')) as { events: unknown[] }
    const during = timeline(body.events.map((event) => conversationEventSchema.parse(event)))
    // 交给专家 → 第一步（只交回了 JSON，没有过程）→ 第二步查了两次数 → 第三步在查
    expect(during.entries.map((entry) => entry.kind)).toEqual([
      'handover',
      'stage',
      'stage',
      'phase',
      'stage',
      'phase',
    ])
    expect(during.entries.filter((entry) => entry.kind === 'stage')).toMatchObject([
      { title: '改写问题' },
      { title: '生成 SQL' },
      { title: '执行 SQL' },
    ])
    expect(during.entries.some((entry) => entry.kind === 'model')).toBe(false)
    expect(during.live).toBeNull()
  })

  it('同一步重做不再摆一次标题、不数第几次；一轮超时也不报「停下了」；交回时说结果', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      session_id: '22222222-2222-4222-8222-222222222222',
      kind: 'task',
      task_id: null,
      attempt_id: null,
      created_at: '2026-10-14T01:00:00Z',
    }
    let cursor = 0
    const at = (type: string, payload: Record<string, unknown>) =>
      conversationEventSchema.parse({ ...base, cursor: ++cursor, type, payload })
    const said = (text: string) =>
      at('item/completed', { item: { type: 'agentMessage', id: `m${cursor}`, text } })
    const line = timeline([
      at('wheel/handover', {}),
      at('step/started', { step_id: 'writeup', title: '成稿', rework: 0 }),
      said('先把两份文件写进去。'),
      at('turn/completed', { turn: { status: 'interrupted' } }),
      at('step/started', { step_id: 'writeup', title: '成稿', rework: 1 }),
      said('```json\n{"answer": "x"}\n```'),
      at('turn/completed', { turn: { status: 'completed' } }),
      at('wheel/return', { final_state: 'SUCCEEDED' }),
    ])
    expect(line.entries.map((entry) => entry.kind)).toEqual([
      'handover',
      'stage',
      'model',
      'handover',
    ])
    expect(line.entries[3]).toMatchObject({
      what: 'returned',
      outcome: 'succeeded',
      writesFiles: true,
    })
    const bare = timeline([
      at('wheel/handover', {}),
      at('wheel/return', { final_state: 'SUCCEEDED', writes_files: false }),
    ])
    expect(bare.entries[1]).toMatchObject({ outcome: 'succeeded', writesFiles: false })
    const stopped = timeline([
      at('wheel/handover', {}),
      at('wheel/return', { final_state: 'CANCELLED' }),
    ])
    expect(stopped.entries[1]).toMatchObject({ outcome: 'stopped' })
    const failed = timeline([
      at('wheel/handover', {}),
      at('wheel/return', { final_state: 'FAILED' }),
    ])
    expect(failed.entries[1]).toMatchObject({ outcome: 'failed' })
    // 受理时就打回（2026-10-14 现网：版本对不上）：不是「没做完」，带上为什么
    const rejected = timeline([
      at('wheel/handover', {}),
      at('wheel/return', { final_state: 'REJECTED', reason_text: '旧版已经换下' }),
    ])
    expect(rejected.entries[1]).toMatchObject({ outcome: 'rejected', reason: '旧版已经换下' })
  })

  it('同一个文件改了两次：在「改动」栏里合成一行', () => {
    const files = byFile([
      { path: '/p/a.md', how: 'add', added: 3, removed: 0, diff: 'x' },
      { path: '/p/a.md', how: 'update', added: 1, removed: 2, diff: 'y' },
      { path: '/p/b.md', how: 'update', added: 1, removed: 1, diff: 'z' },
    ])
    expect(files).toEqual([
      { path: '/p/a.md', how: 'add', added: 4, removed: 2, diffs: ['x', 'y'] },
      { path: '/p/b.md', how: 'update', added: 1, removed: 1, diffs: ['z'] },
    ])
    expect(relativeTo('/p', '/p/a.md')).toBe('a.md')
    expect(relativeTo('/p', '/q/a.md')).toBe('/q/a.md')
    expect(relativeTo(null, '/q/a.md')).toBe('/q/a.md')
  })
})

// 本机上限（approval.md 第三条路）：代理经会合点报上来的那次决定，摆成一行
describe('电脑上的那次允许', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
    kind: 'record',
    task_id: null,
    attempt_id: null,
    created_at: '2026-10-12T08:00:00Z',
  }
  const report = (cursor: number, decision: string, sandbox: string, network: boolean) =>
    conversationEventSchema.parse({
      ...base,
      cursor,
      type: 'agent/localPermission',
      payload: {
        id: '33333333-3333-4333-8333-333333333333',
        conn: 'abcd1234',
        threadId: '44444444-4444-4444-8444-444444444444',
        requestDigest: 'f0e1d2c3b4a5968778695a4b3c2d1e0f' + 'f0e1d2c3b4a5968778695a4b3c2d1e0f',
        permissionDigest: '0'.repeat(64),
        decision,
        scope: { sandbox, network },
        expiresAt: 1760256000,
      },
    })

  it('允许了：范围、摘要前 12 位，一条一行', () => {
    const line = timeline([report(1, 'approved', 'workspace-write', true)])
    expect(line.entries).toEqual([
      {
        kind: 'local',
        key: 'local:33333333-3333-4333-8333-333333333333',
        decision: 'approved',
        sandbox: 'workspace-write',
        network: true,
        digest: 'f0e1d2c3b4a5',
      },
    ])
    // 它不是一轮对话，不改「在干什么」和「上一轮怎么结束的」
    expect(line.live).toBeNull()
    expect(line.last).toBe('none')
  })

  it('没允许：照样摆出来；不认识的沙箱档位当只读', () => {
    const line = timeline([report(2, 'denied', 'something-new', false)])
    expect(line.entries[0]).toMatchObject({
      kind: 'local',
      decision: 'denied',
      sandbox: 'read-only',
    })
  })

  it('专家拿着方向盘时也不藏：那是你在电脑上做的决定', () => {
    const handover = conversationEventSchema.parse({
      ...base,
      cursor: 1,
      type: 'wheel/handover',
      payload: {},
    })
    const line = timeline([handover, report(2, 'approved', 'read-only', true)])
    expect(line.entries.map((entry) => entry.kind)).toEqual(['handover', 'local'])
  })
})

// 活动行的那句细节（0002 第九节）：正在跑的命令、正在查的数据；别的没有
describe('活动行的细节', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
    kind: 'item',
    task_id: null,
    attempt_id: null,
    created_at: '2026-10-12T08:00:00Z',
  }
  const ev = (cursor: number, type: string, payload: Record<string, unknown>) =>
    conversationEventSchema.parse({ ...base, cursor, type, payload })

  it('样例里停在等批准：没有细节', () => {
    expect(liveDetail(timeline(work()))).toBeNull()
  })

  it('正在跑命令：细节是命令本身', () => {
    const running = timeline([
      ev(1, 'turn/requested', { text: '列一下目录' }),
      ev(2, 'turn/started', { turn: { id: 't1' } }),
      ev(3, 'item/started', {
        item: {
          id: 'c1',
          type: 'commandExecution',
          command: 'ls -la',
          cwd: '/p',
          status: 'inProgress',
        },
        turn_id: 't1',
      }),
    ])
    expect(running.live).toBe('command')
    expect(liveDetail(running)).toBe('ls -la')
  })

  it('在想：没有细节', () => {
    const thinking = timeline([
      ev(1, 'turn/requested', { text: '你好' }),
      ev(2, 'turn/started', { turn: { id: 't1' } }),
    ])
    expect(thinking.live).toBe('thinking')
    expect(liveDetail(thinking)).toBeNull()
  })
})
