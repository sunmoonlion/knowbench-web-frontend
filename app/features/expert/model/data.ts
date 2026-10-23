// 请专家时按数据需求声明选数据（SDD 0042 第五节第 6 项）的规则。纯函数。
import type { CloudItem, DataChoice, DataFormat, DataNeed } from '@/contracts/workbench-v2'

export type Picked = { source: 'cloud' | 'local'; name: string; item_id?: string; path?: string }
// 声明里的每一样（key）选了哪几份
export type Picks = Record<string, Picked[]>

const BY_SUFFIX: Record<string, DataFormat> = {
  pdf: 'pdf',
  xlsx: 'excel',
  xls: 'excel',
  csv: 'csv',
  txt: 'text',
  md: 'text',
}
const BY_TYPE: Record<string, DataFormat> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-excel': 'excel',
  'text/csv': 'csv',
  'text/plain': 'text',
  'text/markdown': 'text',
}

export function formatOfName(name: string): DataFormat | null {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : (BY_SUFFIX[name.slice(dot + 1).toLowerCase()] ?? null)
}

export function formatOfType(mediaType: string): DataFormat | null {
  return BY_TYPE[mediaType.split(';')[0].trim().toLowerCase()] ?? null
}

// 本地路径的文件名（Windows、Linux 两种斜杠都认）
export function baseNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export const identityOf = (picked: Picked) =>
  picked.source === 'cloud' ? `cloud:${picked.item_id}` : `local:${picked.path}`

// 云端知识库里这一样能选的：格式对得上的
export function cloudFor(need: DataNeed, items: CloudItem[]): CloudItem[] {
  return items.filter((item) => {
    const format = formatOfType(item.media_type)
    return format !== null && need.formats.includes(format)
  })
}

export function takes(need: DataNeed, name: string): boolean {
  const format = formatOfName(name)
  return format !== null && need.formats.includes(format)
}

// 点一下：没选就加上（到上限就不加），选了就拿掉
export function toggle(picks: Picks, need: DataNeed, picked: Picked): Picks {
  const current = picks[need.key] ?? []
  const id = identityOf(picked)
  if (current.some((each) => identityOf(each) === id)) {
    return { ...picks, [need.key]: current.filter((each) => identityOf(each) !== id) }
  }
  if (current.length >= need.max_count) return picks
  return { ...picks, [need.key]: [...current, picked] }
}

export type PickProblem = {
  need: DataNeed
  count: number
}

// 还不能开始的几样：必填的不够数、选了的不在范围里
export function pickProblems(needs: DataNeed[], picks: Picks): PickProblem[] {
  return needs
    .map((need) => ({ need, count: (picks[need.key] ?? []).length }))
    .filter(
      ({ need, count }) =>
        (need.required || count > 0) && (count < need.min_count || count > need.max_count),
    )
}

// 上次选的那几份，按这一版的声明放回去（声明里没有的那一样丢掉，超出上限的丢掉）
export function picksFromLast(needs: DataNeed[], last: DataChoice[]): Picks {
  let picks: Picks = {}
  for (const choice of last) {
    const need = needs.find((each) => each.key === choice.need)
    if (!need) continue
    picks = toggle(picks, need, {
      source: choice.source,
      name: choice.name ?? choice.item_id ?? baseNameOf(choice.path ?? ''),
      ...(choice.source === 'cloud' ? { item_id: choice.item_id } : { path: choice.path }),
    })
  }
  return picks
}

// 交给后端的那一串：按声明的次序
export function choicesOf(needs: DataNeed[], picks: Picks): DataChoice[] {
  return needs.flatMap((need) =>
    (picks[need.key] ?? []).map((picked) => ({
      need: need.key,
      source: picked.source,
      name: picked.name,
      ...(picked.source === 'cloud' ? { item_id: picked.item_id } : { path: picked.path }),
    })),
  )
}
