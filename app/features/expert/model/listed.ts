// 清单 v2 的专家（SDD 0043 第 3.5 节）：开跑前列出的清单上，用户换选、去掉可选项的规则。纯函数。
// 后端按同一套规矩再核一遍（data_plan.py）；这里只为页面上先说清楚哪几项还不行。
import type {
  DataPlan,
  ListedCandidate,
  ListedItem,
  ListedNeed,
  ListedStatus,
} from '@/contracts/workbench-v2'
import type { ListedChoice } from '@/lib/workbench/expert-desk'

export type ListedPicks = Record<string, { material_id: string; version_no: number }>

// 证券代码（A 股、港股、美股）与机构编号，和 knowbase 词表的主体格式一致
const SUBJECT = /^(\d{6}\.(SH|SZ|BJ)|\d{5}\.HK|[A-Z][A-Z0-9.-]{0,9}\.US|org:[0-9A-Za-z:-]{3,60})$/
export const MAX_SUBJECTS = 10

// 用户填的主体：逗号、顿号、空格都能分隔；代码大写
export function parseSubjects(text: string): { subjects: string[]; bad: string[] } {
  const parts = text
    .split(/[\s,，、;；]+/)
    .map((each) => each.trim())
    .filter(Boolean)
    .map((each) => (each.startsWith('org:') ? each : each.toUpperCase()))
  const unique = [...new Set(parts)]
  return {
    subjects: unique.filter((each) => SUBJECT.test(each)),
    bad: unique.filter((each) => !SUBJECT.test(each)),
  }
}

// 这一项用哪份：换过的用换的那份（要在候选里），没换用 knowbase 挑的
export function chosenOf(item: ListedItem, picks: ListedPicks): ListedCandidate[] {
  const pick = picks[item.ref]
  if (!pick) return item.chosen
  const found = [...item.chosen, ...item.candidates].find(
    (each) => each.material_id === pick.material_id && each.version_no === pick.version_no,
  )
  return found ? [found] : []
}

export type ListedProblem =
  | 'requiredDropped'
  | 'choose'
  | 'noSupply'
  | Exclude<ListedStatus, 'resolved' | 'ambiguous' | 'to_confirm'>

// 这一项开跑前还缺什么（null 是没问题）；可选的去掉了也算没问题
export function itemProblem(
  item: ListedItem,
  need: ListedNeed | undefined,
  plan: DataPlan,
  picks: ListedPicks,
  dropped: string[],
): ListedProblem | null {
  if (dropped.includes(item.ref)) return need?.required === false ? null : 'requiredDropped'
  if (item.status === 'resolved') return null
  if (item.status === 'ambiguous')
    return picks[item.ref] && chosenOf(item, picks).length ? null : 'choose'
  if (item.status === 'to_confirm') return plan.supply_enabled ? null : 'noSupply'
  return item.status
}

// 挡住开跑的：必填项有问题的（可选项的问题只记「不完整」，后端照做）
export function blockingItems(
  plan: DataPlan,
  needs: ListedNeed[],
  picks: ListedPicks,
  dropped: string[],
): ListedItem[] {
  const byKey = new Map(needs.map((need) => [need.key, need]))
  return plan.resolution.items.filter((item) => {
    const need = byKey.get(item.need_key)
    const problem = itemProblem(item, need, plan, picks, dropped)
    return problem !== null && need?.required !== false
  })
}

// 要用户确认、交给数据服务去取的几项（待确认、没去掉的）
export function toFetch(plan: DataPlan, dropped: string[]): ListedItem[] {
  return plan.resolution.items.filter(
    (item) => item.status === 'to_confirm' && !dropped.includes(item.ref),
  )
}

export function choiceOf(plan: DataPlan, picks: ListedPicks, dropped: string[]): ListedChoice {
  return {
    resolution_id: plan.resolution.resolution_id,
    revision: plan.resolution.revision,
    picks,
    dropped,
  }
}

// 期间的写法：定期报告「2025 年」，其余「2025-01-01 至 2025-10-27」
export function periodOf(item: ListedItem): string | null {
  const { period_start: start, period_end: end } = item.key
  if (!start || !end) return null
  if (start.endsWith('-01-01') && end.endsWith('-12-31') && start.slice(0, 4) === end.slice(0, 4)) {
    return start.slice(0, 4)
  }
  return `${start} ~ ${end}`
}
