// 事件 → 聊天页上要显示的东西。纯函数，不取数、不渲染。
// 一轮：用户的一句话，模型在回答之前做的事（查数据、读文件、顺口说的话），最后的回答。
import type { ConversationEvent } from '@/contracts/workbench-v2'
import {
  commandStep,
  dataStep,
  text,
  turnIdOf,
  type CommandStep,
  type DataStep,
  type Item,
} from '@/lib/workbench/items'

export type SaidStep = { kind: 'said'; id: string; text: string }

export type Step = DataStep | CommandStep | SaidStep

export type TurnStatus = 'queued' | 'running' | 'completed' | 'interrupted' | 'failed'

// 模型这会儿在干什么。只在这一轮还在跑的时候有
export type Activity = 'waiting' | 'thinking' | 'data' | 'file' | 'writing'

export type TurnView = {
  key: string
  turnId: string | null
  text: string
  at: string
  steps: Step[]
  answer: { id: string; text: string } | null
  status: TurnStatus
  activity: Activity | null
}

export function thread(events: readonly ConversationEvent[]): TurnView[] {
  const turns: TurnView[] = []
  const byTurnId = (id: string | null) =>
    (id ? turns.find((turn) => turn.turnId === id) : undefined) ?? turns[turns.length - 1]

  // 回答之后又做了别的事：那句话就不是最后的回答，退回成顺口说的话
  const demote = (turn: TurnView) => {
    if (turn.answer === null) return
    turn.steps.push({ kind: 'said', id: turn.answer.id, text: turn.answer.text })
    turn.answer = null
  }
  const put = (turn: TurnView, step: Step) => {
    const at = turn.steps.findIndex((each) => each.id === step.id && each.kind === step.kind)
    if (at >= 0) turn.steps[at] = step
    else {
      demote(turn)
      turn.steps.push(step)
    }
  }

  for (const event of events) {
    const payload = event.payload as Item
    if (event.type === 'turn/requested') {
      turns.push({
        key: text(payload.request_id) || event.id,
        turnId: null,
        text: text(payload.text),
        at: event.created_at,
        steps: [],
        answer: null,
        status: 'queued',
        activity: 'waiting',
      })
      continue
    }
    if (event.type === 'turn/accepted') {
      const turn = turns.find((each) => each.key === text(payload.request_id))
      if (turn) {
        turn.turnId = turnIdOf(payload)
        turn.status = 'running'
      }
      continue
    }
    const turn = byTurnId(turnIdOf(payload))
    if (!turn) continue
    const live = turn.status === 'queued' || turn.status === 'running'

    if (event.type === 'turn/started') {
      if (live) {
        turn.status = 'running'
        turn.activity = 'thinking'
      }
    } else if (event.type === 'turn/completed') {
      const status = text((payload.turn as Item | undefined)?.status)
      turn.status =
        status === 'interrupted' ? 'interrupted' : status === 'failed' ? 'failed' : 'completed'
      turn.activity = null
      for (const step of turn.steps) if (step.kind !== 'said') step.running = false
    } else if (event.type === 'command/failed') {
      if (live && text(payload.kind).startsWith('turn')) {
        turn.status = 'failed'
        turn.activity = null
      }
    } else if (event.type === 'item/started' || event.type === 'item/completed') {
      const item = (payload.item ?? {}) as Item
      const running = event.type === 'item/started'
      if (item.type === 'reasoning') {
        if (running && live) turn.activity = 'thinking'
      } else if (item.type === 'mcpToolCall') {
        put(turn, dataStep(item, running))
        if (live) turn.activity = running ? 'data' : 'thinking'
      } else if (item.type === 'commandExecution') {
        put(turn, commandStep(item, running))
        if (live) turn.activity = running ? 'file' : 'thinking'
      } else if (item.type === 'agentMessage') {
        if (running) {
          if (live) turn.activity = 'writing'
        } else if (text(item.text)) {
          demote(turn)
          turn.answer = { id: text(item.id), text: text(item.text) }
          if (live) turn.activity = 'thinking'
        }
      }
    }
  }
  return turns
}

// 有没有一轮还在跑：发送钮这时候变成停止钮
export function running(turns: readonly TurnView[]): TurnView | null {
  const last = turns[turns.length - 1]
  return last && (last.status === 'queued' || last.status === 'running') ? last : null
}

// 过程收成一行：「查了 2 次数据 · 读了 1 个文件」。数出来，由页面去说
export function tally(steps: readonly Step[]) {
  return {
    data: steps.filter((step) => step.kind === 'data').length,
    files: steps.filter((step) => step.kind === 'file' && step.reading).length,
    commands: steps.filter((step) => step.kind === 'file' && !step.reading).length,
    failed: steps.filter((step) => step.kind !== 'said' && step.failed).length,
  }
}

// 结果边栏要的：最后一次完整的回答；还没有就是 null
export function lastAnswer(turns: readonly TurnView[]): string | null {
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    const answer = turns[at].answer
    if (answer && answer.text.trim()) return answer.text
  }
  return null
}
