'use client'

// 委托用的数据（清单 v2 的专家，SDD 0043、decisions ⑭）：委托页与项目看板共用。
// 第 0 步模型提出要哪些数据，用户在这里确认：换一份、改主体或期间、去掉、自己加一样。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { z } from 'zod'

import {
  type DataRequest,
  type DataRequestItem,
  type ListedCandidate,
  type ListedItem,
  taskDataSchema,
} from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { getJson, seg, sendJson } from '@/lib/workbench/http'

export const taskDataKey = (task: string) => ['workbench', 'task-data', task] as const

export function useTaskData(task: string, beat = 0) {
  return useQuery({
    queryKey: [...taskDataKey(task), beat],
    queryFn: () => getJson(taskDataSchema, `/api/workbench/tasks/${seg(task)}/data`),
    placeholderData: (previous) => previous,
    // 采集进度更新不一定产生对话事件；等待时读取服务端快照，办结后停止。
    refetchInterval: (query) => (query.state.data?.status === 'waiting' ? 10_000 : false),
  })
}

export type Pick = { material_id: string; version_no: number }
export type ConfirmBody = {
  picks?: Record<string, Pick>
  dropped?: string[]
  needs?: Record<string, unknown>[]
}

const answered = z.object({ status: z.string() }).loose()

export function useTaskDataActions(task: string) {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  // 确认以后委托的状态、看板、待办都会变：工作台的都重取
  const changed = () => client.invalidateQueries({ queryKey: ['workbench'] })
  return {
    confirm: useMutation({
      mutationFn: (body: ConfirmBody) =>
        sendJson(answered, `/api/workbench/tasks/${seg(task)}/data-requests/confirm`, {
          csrfToken,
          body,
        }),
      onSuccess: changed,
    }),
    // 「传好了，重新查」：去 knowbase 上传了采不来的那份，请 knowbase 重新解析
    recheck: useMutation({
      mutationFn: () =>
        sendJson(answered, `/api/workbench/tasks/${seg(task)}/data-requests/recheck`, {
          csrfToken,
        }),
      onSuccess: changed,
    }),
    // 不要提出的这几样，或者没取到的照现有的接着做
    decline: useMutation({
      mutationFn: () =>
        sendJson(answered, `/api/workbench/tasks/${seg(task)}/data-requests/decline`, {
          csrfToken,
        }),
      onSuccess: changed,
    }),
  }
}

// —— 确认前的改动（纯函数）——

// 证券代码（A 股、港股、美股）与机构编号，和 knowbase 词表的主体格式一致
export const SUBJECT =
  /^(\d{6}\.(SH|SZ|BJ)|\d{5}\.HK|[A-Z][A-Z0-9.-]{0,9}\.US|org:[0-9A-Za-z:-]{3,60})$/

export function normalSubject(text: string): string | null {
  const value = text.trim()
  if (!value) return null
  return value.startsWith('org:') ? value : value.toUpperCase()
}

export type Edit = {
  subject?: string | null
  from?: number
  to?: number
  source_query?: DataRequest['source_query']
}
export type Added = { doc_type: string; subject: string | null; from: number; to: number }
export type Changes = {
  picks: Record<string, Pick>
  dropped: string[]
  edits: Record<string, Edit>
  added: Added[]
}
export const noChanges: Changes = { picks: {}, dropped: [], edits: {}, added: [] }

function fixed(from: number, to: number) {
  const [a, b] = from <= to ? [from, to] : [to, from]
  return { kind: 'fixed', start: `${a}-01-01`, end: `${b}-12-31` }
}

// 改过的一样：换主体、改成固定的几年
export function edited(need: DataRequest, edit: Edit | undefined): DataRequest {
  if (edit?.source_query) return { ...need, source_query: edit.source_query }
  if (!edit) return need
  const out: DataRequest = { ...need }
  if (edit.subject !== undefined) out.subject = edit.subject
  if (edit.from !== undefined && edit.to !== undefined) out.period = fixed(edit.from, edit.to)
  return out
}

// 交给后端的：改了主体、期间或自己加了的，带整份 `needs`（去掉的不带）；换选只留没改的那几样
export function confirmBody(request: DataRequestItem, changes: Changes): ConfirmBody {
  const touched = Object.keys(changes.edits).length > 0 || changes.added.length > 0
  const byNeed = new Map(request.items.map((item) => [item.ref, item.need_key]))
  const changedNeeds = new Set(Object.keys(changes.edits))
  const picks = Object.fromEntries(
    Object.entries(changes.picks).filter(([ref]) => !changedNeeds.has(byNeed.get(ref) ?? '')),
  )
  const body: ConfirmBody = {}
  if (Object.keys(picks).length) body.picks = picks
  if (!touched) {
    if (changes.dropped.length) body.dropped = changes.dropped
    return body
  }
  const gone = new Set(
    request.items.filter((item) => changes.dropped.includes(item.ref)).map((i) => i.need_key),
  )
  body.needs = [
    ...request.needs
      .filter((need) => !gone.has(need.key))
      .map((need) => edited(need, changes.edits[need.key])),
    ...changes.added.map((add) => ({
      doc_type: add.doc_type,
      name: add.doc_type,
      ...(add.subject ? { subject: add.subject } : {}),
      period: fixed(add.from, add.to),
      reading: 'pages',
    })),
  ]
  return body
}

// 这一样用哪份：换过的用换的那份（要在候选里），没换用 knowbase 挑的
export function chosenOf(item: ListedItem, picks: Record<string, Pick>): ListedCandidate[] {
  const pick = picks[item.ref]
  if (!pick) return item.chosen
  const found = [...item.chosen, ...item.candidates].find(
    (each) => each.material_id === pick.material_id && each.version_no === pick.version_no,
  )
  return found ? [found] : []
}

// 期间的写法：定期报告「2025」，其余「2025-01-01 ~ 2025-10-27」，不限期间是 null
export function periodOf(item: ListedItem): string | null {
  const { period_start: start, period_end: end } = item.key
  if (!start || !end) return null
  if (start.endsWith('-01-01') && end.endsWith('-12-31') && start.slice(0, 4) === end.slice(0, 4)) {
    return start.slice(0, 4)
  }
  return `${start} ~ ${end}`
}

// 去 knowbase 直达上传时按这一样的描述预填（没有的不带）
export function uploadValues(item: ListedItem): Record<string, string> {
  const { subject, doc_type, period_start, period_end, edition } = item.key
  const out: Record<string, string> = { doc_type }
  for (const [name, value] of Object.entries({ subject, period_start, period_end, edition })) {
    if (typeof value === 'string' && value) out[name] = value
  }
  return out
}

// 预计多久的粗写法：不到一小时按分钟，不到一天按小时，再长按天（都往上取整）
export function roughDuration(seconds: number): { unit: 'minutes' | 'hours' | 'days'; n: number } {
  if (seconds < 3600) return { unit: 'minutes', n: Math.max(1, Math.ceil(seconds / 60)) }
  if (seconds < 86400) return { unit: 'hours', n: Math.ceil(seconds / 3600) }
  return { unit: 'days', n: Math.ceil(seconds / 86400) }
}

// 有歧义、又没选也没去掉的：确认不了
export function unchosen(request: DataRequestItem, changes: Changes): ListedItem[] {
  return request.items.filter(
    (item) =>
      item.status === 'ambiguous' &&
      !changes.dropped.includes(item.ref) &&
      !chosenOf(item, changes.picks).length &&
      !(item.need_key in changes.edits),
  )
}
