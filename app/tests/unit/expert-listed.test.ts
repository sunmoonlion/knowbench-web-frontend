// 清单 v2 的专家（SDD 0043 第 3.5 节）：开跑前列出的清单上换选、去掉可选项的规则
import { describe, expect, it } from 'vitest'

import type { DataPlan, ListedItem, ListedNeed } from '@/contracts/workbench-v2'
import {
  blockingItems,
  choiceOf,
  chosenOf,
  itemProblem,
  parseSubjects,
  periodOf,
  toFetch,
} from '@/features/expert/model/listed'

const need = (key: string, required = true): ListedNeed => ({
  key,
  name: key,
  doc_type: 'annual_report',
  period: { kind: 'latest' },
  required,
  description: '',
})
const candidate = (id: string) => ({
  material_id: id,
  version_no: 1,
  basis: 'public',
  name: `${id}.pdf`,
})
const item = (
  ref: string,
  status: ListedItem['status'],
  more: Partial<ListedItem> = {},
): ListedItem => ({
  ref,
  need_key: 'annual',
  key: {
    subject: '600519.SH',
    doc_type: 'annual_report',
    period_start: '2025-01-01',
    period_end: '2025-12-31',
  },
  status,
  chosen: status === 'resolved' ? [candidate('m1')] : [],
  candidates: [],
  reason: null,
  ...more,
})
const plan = (items: ListedItem[], supply = true): DataPlan => ({
  resolution: { resolution_id: 'res-1', revision: 1, items },
  supply_enabled: supply,
  bound: 0,
  to_confirm: 0,
  problems: [],
  incomplete: [],
})

describe('列清单', () => {
  it('主体：几种分隔都认，代码大写，认不出的单列', () => {
    expect(parseSubjects('600519.sh，000001.SZ、 茅台 00700.hk')).toEqual({
      subjects: ['600519.SH', '000001.SZ', '00700.HK'],
      bad: ['茅台'],
    })
  })

  it('已有的默认用、可以换成候选里的；有歧义的要选', () => {
    const both = [candidate('m1'), candidate('m2')]
    const ambiguous = item('a', 'ambiguous', { candidates: both })
    const p = plan([ambiguous])
    expect(itemProblem(ambiguous, need('annual'), p, {}, [])).toBe('choose')
    const picks = { a: { material_id: 'm2', version_no: 1 } }
    expect(itemProblem(ambiguous, need('annual'), p, picks, [])).toBeNull()
    expect(chosenOf(ambiguous, picks).map((each) => each.material_id)).toEqual(['m2'])
    expect(chosenOf(ambiguous, { a: { material_id: 'mx', version_no: 1 } })).toEqual([])
  })

  it('缺的要去取：补采开着才行；必填的不能不用，可选的可以', () => {
    const missing = item('m', 'to_confirm')
    expect(blockingItems(plan([missing]), [need('annual')], {}, [])).toEqual([])
    expect(blockingItems(plan([missing], false), [need('annual')], {}, [])).toEqual([missing])
    expect(toFetch(plan([missing]), [])).toEqual([missing])
    expect(itemProblem(missing, need('annual'), plan([missing]), {}, ['m'])).toBe('requiredDropped')
    const hidden = item('h', 'not_shown')
    expect(blockingItems(plan([hidden]), [need('annual', false)], {}, [])).toEqual([])
    expect(itemProblem(hidden, need('annual', false), plan([hidden]), {}, ['h'])).toBeNull()
    expect(toFetch(plan([missing]), ['m'])).toEqual([])
  })

  it('交给后端的选择；期间的写法', () => {
    expect(choiceOf(plan([]), { a: { material_id: 'm2', version_no: 1 } }, ['b'])).toEqual({
      resolution_id: 'res-1',
      revision: 1,
      picks: { a: { material_id: 'm2', version_no: 1 } },
      dropped: ['b'],
    })
    expect(periodOf(item('x', 'resolved'))).toBe('2025')
    expect(
      periodOf(
        item('y', 'resolved', {
          key: {
            subject: '600519.SH',
            doc_type: 'interim_announcement',
            period_start: '2025-10-27',
            period_end: '2026-10-27',
          },
        }),
      ),
    ).toBe('2025-10-27 ~ 2026-10-27')
  })
})
