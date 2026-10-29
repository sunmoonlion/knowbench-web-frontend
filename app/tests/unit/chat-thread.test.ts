import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { conversationEventSchema, type ConversationEvent } from '@/contracts/workbench-v2'
import { running, tally, thread } from '@/features/chat/model/thread'
import { spent } from '@/features/usage/model/spent'
import { money, toMicros } from '@/lib/workbench/money'

// 样例是真后端录下来的：不属于项目的那段聊天，和项目里的那段聊天
const full = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as {
  pages: { title: string; path: string }[]
  responses: { method: string; path: string; query: string; file: string }[]
}

function eventsOf(pageTitle: string): ConversationEvent[] {
  const page = manifest.pages.find((each) => each.title.startsWith(pageTitle))!
  const id = page.path.split('/').pop()!
  const found = manifest.responses.find(
    (each) => each.path === `/api/workbench/sessions/${id}/events`,
  )!
  const body = JSON.parse(readFileSync(join(full, found.file), 'utf8')) as { events: unknown[] }
  return body.events.map((event) => conversationEventSchema.parse(event))
}

let n = 0
function event(type: string, payload: Record<string, unknown>): ConversationEvent {
  n += 1
  return conversationEventSchema.parse({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    session_id: '00000000-0000-4000-8000-000000000000',
    cursor: n,
    kind: 'x',
    type,
    payload,
    task_id: null,
    attempt_id: null,
    created_at: '2026-10-04T00:00:00Z',
  })
}

describe('聊天：事件变成一轮一轮', () => {
  it('不属于项目的聊天：三轮，第三轮问到没有数据的公司', () => {
    const turns = thread(eventsOf('聊天（不属于项目'))
    expect(turns.map((turn) => turn.status)).toEqual(['completed', 'completed', 'completed'])
    expect(turns[0].text).toBe('毛利率和净利率有什么区别？用三句话说清楚。')
    expect(turns[0].answer?.text).toContain('毛利率')
    expect(turns[0].steps).toEqual([])
    // 模型的思考不显示
    expect(JSON.stringify(turns)).not.toContain('The user is asking')
    const third = turns[2]
    expect(third.steps).toHaveLength(1)
    expect(third.steps[0]).toMatchObject({
      kind: 'data',
      server: 'sunmoon_knowbase',
      tool: 'describe_schema',
      dataset: 'sh600436-financials',
      failed: true,
      running: false,
    })
    // 不再另记「没有数据」（decisions 10-29「发版前补齐」①）：只看模型的回答
    expect(third).not.toHaveProperty('missing')
    expect(third.answer?.text).toContain('还没有入库')
    expect(running(turns)).toBeNull()
  })

  it('项目里的聊天：读文件收成一行，回答之前顺口说的话不当成回答', () => {
    const turns = thread(eventsOf('项目里的聊天'))
    const first = turns[0]
    expect(first.steps.map((step) => step.kind)).toEqual(['said', 'file'])
    expect(first.answer).not.toBeNull()
    const reads = turns.flatMap((turn) => turn.steps).filter((step) => step.kind === 'file')
    expect(reads.some((step) => step.reading && step.label === '年报要点.md')).toBe(true)
    expect(tally(first.steps)).toEqual({ data: 0, files: 0, commands: 1, failed: 0 })
  })

  it('还在跑的一轮：说得出它这会儿在干什么', () => {
    const asked = event('turn/requested', { request_id: 'r1', text: '问', by: 'user' })
    expect(thread([asked])[0]).toMatchObject({ status: 'queued', activity: 'waiting' })
    const accepted = event('turn/accepted', { request_id: 'r1', turn: { id: 't1' } })
    const started = event('turn/started', { turn: { id: 't1' } })
    expect(thread([asked, accepted, started])[0].activity).toBe('thinking')
    const calling = event('item/started', {
      turnId: 't1',
      item: { type: 'mcpToolCall', id: 'c1', server: 's', tool: 'query', arguments: {} },
    })
    const now = thread([asked, accepted, started, calling])
    expect(now[0].activity).toBe('data')
    expect(now[0].steps[0]).toMatchObject({ kind: 'data', running: true, failed: false })
    expect(running(now)?.turnId).toBe('t1')
    const called = event('item/completed', {
      turnId: 't1',
      item: {
        type: 'mcpToolCall',
        id: 'c1',
        server: 's',
        tool: 'query',
        status: 'completed',
        arguments: { dataset: 'd' },
        result: { content: [{ type: 'text', text: '{"data_version": "v9", "rows": []}' }] },
      },
    })
    const writing = event('item/started', {
      turnId: 't1',
      item: { type: 'agentMessage', id: 'm1' },
    })
    const after = thread([asked, accepted, started, calling, called, writing])
    // 同一次调用开始和结束是一行，不是两行
    expect(after[0].steps).toHaveLength(1)
    expect(after[0].steps[0]).toMatchObject({ running: false, version: 'v9', dataset: 'd' })
    expect(after[0].activity).toBe('writing')
  })

  it('被停下的一轮', () => {
    const turns = thread([
      event('turn/requested', { request_id: 'r2', text: '问' }),
      event('turn/accepted', { request_id: 'r2', turn: { id: 't2' } }),
      event('turn/started', { turn: { id: 't2' } }),
      event('turn/stop_requested', { turn_id: 't2', by: 'user', running: true }),
      event('turn/completed', { turn: { id: 't2', status: 'interrupted' } }),
    ])
    expect(turns[0]).toMatchObject({ status: 'interrupted', activity: null, answer: null })
    expect(running(turns)).toBeNull()
  })
})

describe('花费：把每一次调用相加', () => {
  it('和后端的合计一分不差', () => {
    const events = eventsOf('聊天（不属于项目')
    const id = events[0].session_id
    const found = manifest.responses.find(
      (each) => each.path === `/api/workbench/sessions/${id}/usage`,
    )!
    const usage = JSON.parse(readFileSync(join(full, found.file), 'utf8')) as {
      cost: string
      calls: number
      tokens: { total: number }
    }
    const total = spent(events)
    expect(total.micros).toBe(toMicros(usage.cost))
    expect(total.calls).toBe(usage.calls)
    expect(total.tokens).toBe(usage.tokens.total)
  })

  it('有一次调用没有单价：不给金额', () => {
    const tokens = { input: 1, cached_input: 0, cache_write: 0, output: 1, total: 2 }
    const base = { currency: 'CNY', estimated: true, call_tokens: tokens, turn_tokens: tokens }
    const total = spent([
      event('thread/tokenUsage/updated', {
        cost: { ...base, model: 'kimi-k3', priced: true, call: '0.010000', turn: '0.010000' },
      }),
      event('thread/tokenUsage/updated', {
        cost: { ...base, model: 'x', priced: false, call: null, turn: null },
      }),
    ])
    expect(total).toEqual({ micros: null, currency: 'CNY', calls: 2, tokens: 4 })
  })

  it('金额的写法', () => {
    expect(toMicros('0.290504')).toBe(290504)
    expect(toMicros('12')).toBe(12_000_000)
    expect(toMicros('abc')).toBeNull()
    expect(money(290504)).toBe('0.291')
    expect(money(0)).toBe('0.000')
    expect(money(1_204_000)).toBe('1.20')
  })
})
