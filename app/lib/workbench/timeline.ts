// 事件 → 工作页的过程时间线。纯函数。
// 时间线不是气泡：重点是「它在我的目录里做了什么」。
// 一段过程（它说了一句要做什么，接着跑了几条命令）收成一行，点开才看细节；
// 改文件、等你批准、没有数据这三样一直摆在外面，不收起来。
import type { ConversationEvent } from '@/contracts/workbench-v2'
import {
  changeStep,
  commandStep,
  dataStep,
  text,
  turnIdOf,
  type ChangedFile,
  type ChangeStep,
  type CommandStep,
  type DataStep,
  type Item,
} from '@/lib/workbench/items'

export type Approval = {
  id: string
  token: string
  command: string
  cwd: string
  reason: string
  state: 'pending' | 'answered' | 'expired'
  decision: string | null
  // 后端给的按钮；没有就用默认的两个
  options: { id: string; label: string }[]
  // 顾问驾驶时：属于哪一步、之后哪些步骤依赖它、同一步里是不是刚拒绝过
  step: { index: number; title: string } | null
  dependents: { step_id: string; title: string }[]
  afterDecline: boolean
}

// Codex 反过来问用户：一到三个问题，每题可选可答（approval.md「澄清，不是审批」）
export type Question = {
  id: string
  token: string
  title: string
  questions: {
    id: string
    header: string
    question: string
    options: { label: string; description: string }[]
    is_other: boolean
    is_secret: boolean
  }[]
  state: 'pending' | 'answered' | 'expired'
}

export type Entry =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'model'; key: string; text: string; turn: string | null }
  | {
      kind: 'phase'
      key: string
      said: string | null
      steps: (DataStep | CommandStep)[]
      turn: string | null
    }
  | { kind: 'change'; key: string; step: ChangeStep }
  | { kind: 'approval'; key: string; approval: Approval }
  | { kind: 'question'; key: string; question: Question }
  // 策略替用户答的：放行折叠一行，拒绝说明「顾问想做 X，按专家包规则拒绝了」
  | { kind: 'policy'; key: string; decision: 'accept' | 'decline'; command: string; source: string }
  // 本机上限（approval.md 第三条路）：请求越出了你电脑上的默认上限，你在电脑上当面允许或没允许。
  // 云端没有人能替你答；这里只是把那次决定摆出来
  | {
      kind: 'local'
      key: string
      decision: 'approved' | 'denied'
      sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
      network: boolean
      // 请求摘要（SHA-256）的前 12 位，和电脑上弹窗里的那一串对得上
      digest: string
    }
  | { kind: 'missing'; key: string; code: string; dataset: string | null }
  // 交给专家、专家交回。交回时带上这件委托怎么结束的，好告诉用户去「工作底稿」看；
  // 打回是受理时就没接（一步没做、没有底稿），带上为什么，不叫人去看底稿
  | {
      kind: 'handover'
      key: string
      what: 'given' | 'returned'
      outcome?: 'succeeded' | 'stopped' | 'failed' | 'rejected'
      reason?: string
      // 这位专家写不写成稿文件；老事件没有这一项，按写算
      writesFiles?: boolean
    }
  // 专家开始做哪一步。同一步重做不再摆一次：对话里只看过程，不数第几次（所有者 2026-10-14）
  | { kind: 'stage'; key: string; title: string }
  | { kind: 'notice'; key: string; what: 'stopped' | 'failed' }

export type Activity =
  | 'waiting'
  | 'thinking'
  | 'data'
  | 'command'
  | 'change'
  | 'writing'
  | 'approval'

export type Timeline = {
  entries: Entry[]
  // 有一轮还在跑：它这会儿在干什么
  live: Activity | null
  // 上一轮是怎么结束的
  last: 'none' | 'completed' | 'stopped' | 'failed'
  // 这段对话里用补丁改过的文件。同一个文件改了几次就有几条，按先后
  changes: ChangedFile[]
}

export function timeline(events: readonly ConversationEvent[]): Timeline {
  const entries: Entry[] = []
  const changes = new Map<string, ChangeStep>()
  let live: Activity | null = null
  let last: Timeline['last'] = 'none'
  let asked = 0
  // 专家拿着方向盘的时候：过程照常摆（查数、命令、改文件、它说的话），只是每一步最后交回的
  // 那段 JSON 是给验收看的原样，不是给人读的话，不摆进来；一轮结束也不报「停下了 / 出错了」，
  // 那是专家自己的返工，结果在交回那一行说
  let expert = false
  let stage: string | null = null

  const attach = (step: DataStep | CommandStep, turn: string | null) => {
    for (const entry of entries) {
      if (entry.kind !== 'phase') continue
      const at = entry.steps.findIndex((each) => each.id === step.id && each.kind === step.kind)
      if (at >= 0) {
        entry.steps[at] = step
        return
      }
    }
    const tail = entries[entries.length - 1]
    if (tail?.kind === 'phase' && tail.turn === turn) {
      tail.steps.push(step)
    } else if (tail?.kind === 'model' && tail.turn === turn) {
      // 它刚说了一句要做什么，接着就动手：那句话是这一段过程的标题
      entries[entries.length - 1] = {
        kind: 'phase',
        key: tail.key,
        said: tail.text,
        steps: [step],
        turn,
      }
    } else {
      entries.push({ kind: 'phase', key: `phase:${step.id}`, said: null, steps: [step], turn })
    }
  }

  for (const event of events) {
    const payload = event.payload as Item
    const turn = turnIdOf(payload)
    if (expert) {
      if (event.type === 'step/started') {
        const id = text(payload.step_id)
        if (id && id !== stage) {
          stage = id
          entries.push({ kind: 'stage', key: `stage:${event.cursor}`, title: text(payload.title) })
        }
        continue
      }
      if (event.type === 'turn/completed') {
        live = null
        for (const entry of entries) {
          if (entry.kind === 'phase') for (const step of entry.steps) step.running = false
        }
        continue
      }
      if (event.type === 'command/failed') continue
      if (event.type === 'item/completed') {
        const item = (payload.item ?? {}) as Item
        if (item.type === 'agentMessage' && looksLikeArtifact(text(item.text))) continue
      }
    }
    switch (event.type) {
      case 'turn/requested':
        entries.push({ kind: 'user', key: `user:${event.cursor}`, text: text(payload.text) })
        asked += 1
        live = 'waiting'
        break
      case 'turn/started':
        if (asked > 0) live = 'thinking'
        break
      case 'turn/completed': {
        const status = text((payload.turn as Item | undefined)?.status)
        live = null
        last = status === 'interrupted' ? 'stopped' : status === 'failed' ? 'failed' : 'completed'
        for (const entry of entries) {
          if (entry.kind === 'phase') for (const step of entry.steps) step.running = false
        }
        if (last !== 'completed') {
          entries.push({ kind: 'notice', key: `notice:${event.cursor}`, what: last })
        }
        break
      }
      case 'command/failed':
        if (live !== null && text(payload.kind).startsWith('turn')) {
          live = null
          last = 'failed'
          entries.push({ kind: 'notice', key: `notice:${event.cursor}`, what: 'failed' })
        }
        break
      case 'data.missing': {
        const code = text(payload.security_code)
        if (code && !entries.some((entry) => entry.kind === 'missing' && entry.code === code)) {
          entries.push({
            kind: 'missing',
            key: `missing:${code}`,
            code,
            dataset: text(payload.dataset) || null,
          })
        }
        break
      }
      case 'interaction/opened': {
        const prompt = (payload.prompt ?? {}) as Item
        const subject = (payload.subject ?? prompt.subject ?? {}) as Item
        if (payload.kind === 'question') {
          entries.push({
            kind: 'question',
            key: `question:${text(payload.interaction_id)}`,
            question: {
              id: text(payload.interaction_id),
              token: text(payload.token),
              title: text(prompt.title),
              questions: Array.isArray(subject.questions)
                ? (subject.questions as Item[]).map((q) => ({
                    id: text(q.id),
                    header: text(q.header),
                    question: text(q.question),
                    options: Array.isArray(q.options)
                      ? (q.options as Item[]).map((o) => ({
                          label: text(o.label),
                          description: text(o.description),
                        }))
                      : [],
                    is_other: q.is_other !== false,
                    is_secret: q.is_secret === true,
                  }))
                : [],
              state: 'pending',
            },
          })
          live = 'approval'
          break
        }
        if (payload.kind !== 'tool_approval') break
        const step = (subject.step ?? null) as Item | null
        entries.push({
          kind: 'approval',
          key: `approval:${text(payload.interaction_id)}`,
          approval: {
            id: text(payload.interaction_id),
            token: text(payload.token),
            command: text(subject.command) || text(subject.category),
            cwd: text(subject.cwd),
            reason: text(subject.reason),
            state: 'pending',
            decision: null,
            options: Array.isArray(prompt.options)
              ? (prompt.options as Item[]).map((o) => ({ id: text(o.id), label: text(o.label) }))
              : [],
            step: step ? { index: Number(step.index ?? 0), title: text(step.title) } : null,
            dependents: Array.isArray(subject.dependents)
              ? (subject.dependents as Item[]).map((d) => ({
                  step_id: text(d.step_id),
                  title: text(d.title),
                }))
              : [],
            afterDecline: subject.after_decline === true,
          },
        })
        live = 'approval'
        break
      }
      case 'interaction/consumed':
      case 'interaction/expired': {
        const state = event.type === 'interaction/expired' ? 'expired' : 'answered'
        const found = entries.find(
          (entry) =>
            (entry.kind === 'approval' && entry.approval.id === text(payload.interaction_id)) ||
            (entry.kind === 'question' && entry.question.id === text(payload.interaction_id)),
        )
        if (found?.kind === 'approval') {
          found.approval.state = state
          found.approval.decision =
            text(((payload.response ?? {}) as Item).decision) || found.approval.decision
          if (live === 'approval') live = 'thinking'
        } else if (found?.kind === 'question') {
          found.question.state = state
          if (live === 'approval') live = 'thinking'
        }
        break
      }
      case 'approval/policy': {
        const subject = (payload.subject ?? {}) as Item
        entries.push({
          kind: 'policy',
          key: `policy:${event.cursor}`,
          decision: payload.decision === 'decline' ? 'decline' : 'accept',
          command: text(subject.command) || text(subject.category),
          source: text(payload.source),
        })
        break
      }
      case 'agent/localPermission': {
        // 本地代理经会合点报上来的记录，机器同步时才落库，所以它多半排在那条命令之后
        const scope = (payload.scope ?? {}) as Item
        const sandbox = text(scope.sandbox)
        entries.push({
          kind: 'local',
          key: `local:${text(payload.id) || event.cursor}`,
          decision: payload.decision === 'approved' ? 'approved' : 'denied',
          sandbox:
            sandbox === 'workspace-write' || sandbox === 'danger-full-access'
              ? sandbox
              : 'read-only',
          network: scope.network === true,
          digest: text(payload.requestDigest).slice(0, 12),
        })
        break
      }
      case 'wheel/handover':
        entries.push({ kind: 'handover', key: `handover:${event.cursor}`, what: 'given' })
        expert = true
        stage = null
        live = null
        break
      case 'wheel/return': {
        const final = text(payload.final_state)
        entries.push({
          kind: 'handover',
          key: `handover:${event.cursor}`,
          what: 'returned',
          outcome:
            final === 'SUCCEEDED'
              ? 'succeeded'
              : final === 'CANCELLED'
                ? 'stopped'
                : final === 'REJECTED'
                  ? 'rejected'
                  : 'failed',
          reason: text(payload.reason_text),
          writesFiles: payload.writes_files !== false,
        })
        expert = false
        live = null
        break
      }
      case 'item/started':
      case 'item/completed': {
        const item = (payload.item ?? {}) as Item
        const running = event.type === 'item/started'
        const busy = live !== null && live !== 'approval'
        if (item.type === 'reasoning') {
          if (running && busy) live = 'thinking'
        } else if (item.type === 'mcpToolCall') {
          attach(dataStep(item, running), turn)
          if (busy) live = running ? 'data' : 'thinking'
        } else if (item.type === 'commandExecution') {
          attach(commandStep(item, running), turn)
          if (busy) live = running ? 'command' : 'thinking'
        } else if (item.type === 'fileChange') {
          const step = changeStep(item, running)
          const at = entries.findIndex(
            (entry) => entry.kind === 'change' && entry.step.id === step.id,
          )
          if (at >= 0) entries[at] = { kind: 'change', key: `change:${step.id}`, step }
          else entries.push({ kind: 'change', key: `change:${step.id}`, step })
          if (!running && !step.failed) changes.set(step.id, step)
          if (busy) live = running ? 'change' : 'thinking'
        } else if (item.type === 'agentMessage') {
          if (running) {
            if (busy) live = 'writing'
          } else if (text(item.text)) {
            entries.push({
              kind: 'model',
              key: `model:${text(item.id) || event.cursor}`,
              text: text(item.text),
              turn,
            })
            if (busy) live = 'thinking'
          }
        }
        break
      }
    }
  }
  return {
    entries,
    live,
    last,
    changes: [...changes.values()].flatMap((step) => step.files),
  }
}

// 专家一步交回的原样：一个 JSON 对象（可能包在 ```json 围栏里）。它说的过程话不是这样
export function looksLikeArtifact(said: string): boolean {
  const body = said.trim()
  return body.startsWith('{') || body.startsWith('```')
}

// 「改动」栏：一个文件一行，同一个文件改了几次合在一起
export type FileChanges = {
  path: string
  how: ChangedFile['how']
  added: number
  removed: number
  diffs: string[]
}

export function byFile(changes: readonly ChangedFile[]): FileChanges[] {
  const files = new Map<string, FileChanges>()
  for (const change of changes) {
    const seen = files.get(change.path)
    if (seen) {
      seen.added += change.added
      seen.removed += change.removed
      seen.diffs.push(change.diff)
      // 先新建后修改，还是「新建」；后来删了，就是「删除」
      if (change.how === 'delete') seen.how = 'delete'
    } else {
      files.set(change.path, {
        path: change.path,
        how: change.how,
        added: change.added,
        removed: change.removed,
        diffs: [change.diff],
      })
    }
  }
  return [...files.values()]
}

export function phaseTally(steps: readonly (DataStep | CommandStep)[]) {
  return {
    commands: steps.filter((step) => step.kind === 'file').length,
    data: steps.filter((step) => step.kind === 'data').length,
    failed: steps.filter((step) => step.failed).length,
    running: steps.some((step) => step.running),
  }
}

// 活动行要的那一句细节：正在跑的命令、正在查的数据。找最后一段过程里还在跑的那一步
export function liveDetail(line: Timeline): string | null {
  if (line.live !== 'command' && line.live !== 'data') return null
  for (let at = line.entries.length - 1; at >= 0; at -= 1) {
    const entry = line.entries[at]
    if (entry.kind !== 'phase') continue
    for (let each = entry.steps.length - 1; each >= 0; each -= 1) {
      const step = entry.steps[each]
      if (!step.running) continue
      if (step.kind === 'file') return step.label || step.command || null
      return step.dataset ?? step.tool ?? null
    }
  }
  return null
}
