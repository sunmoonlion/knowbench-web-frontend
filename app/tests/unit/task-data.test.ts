import { describe, expect, it } from 'vitest'

import type { DataRequestItem } from '@/contracts/workbench-v2'
import { confirmBody, noChanges, periodOf, unchosen } from '@/lib/workbench/task-data'

const need = (key: string, start: string) => ({
  key,
  name: `年报 ${start}`,
  subject: '600519.SH',
  doc_type: 'annual_report',
  period: { kind: 'fixed', start: `${start}-01-01`, end: `${start}-12-31` },
  required: false,
  reading: 'pages',
  description: '',
})
const item = (ref: string, needKey: string, year: string, status = 'resolved') => ({
  ref,
  need_key: needKey,
  key: {
    subject: '600519.SH',
    doc_type: 'annual_report',
    period_start: `${year}-01-01`,
    period_end: `${year}-12-31`,
  },
  status: status as 'resolved',
  chosen:
    status === 'resolved'
      ? [{ material_id: `m-${year}`, version_no: 1, basis: 'public', name: '' }]
      : [],
  candidates:
    status === 'ambiguous'
      ? [
          { material_id: 'a', version_no: 1, basis: 'display', name: '' },
          { material_id: 'b', version_no: 1, basis: 'display', name: '' },
        ]
      : [],
  reason: null,
})
const request: DataRequestItem = {
  id: 'r1',
  labels: [],
  status: 'pending',
  needs: [need('req1_1', '2025'), need('req1_2', '2024')],
  items: [item('i1', 'req1_1', '2025'), item('i2', 'req1_2', '2024', 'ambiguous')],
  missing: [],
}

describe('确认专家提出的数据（decisions ⑭）', () => {
  it('没改：照提出的确认，只带换选与去掉的', () => {
    expect(confirmBody(request, noChanges)).toEqual({})
    expect(confirmBody(request, { ...noChanges, dropped: ['i2'] })).toEqual({ dropped: ['i2'] })
    expect(
      confirmBody(request, { ...noChanges, picks: { i2: { material_id: 'b', version_no: 1 } } }),
    ).toEqual({ picks: { i2: { material_id: 'b', version_no: 1 } } })
  })

  it('改了主体、年份或自己加了一样：带整份，去掉的不带，改过的那样不带换选', () => {
    const body = confirmBody(request, {
      picks: { i2: { material_id: 'b', version_no: 1 } },
      dropped: ['i1'],
      edits: { req1_2: { subject: '000858.SZ', from: 2023, to: 2022 } },
      added: [{ doc_type: 'interim_announcement', subject: null, from: 2025, to: 2025 }],
    })
    expect(body.picks).toBeUndefined()
    expect(body.needs).toEqual([
      {
        ...need('req1_2', '2024'),
        subject: '000858.SZ',
        period: { kind: 'fixed', start: '2022-01-01', end: '2023-12-31' },
      },
      {
        doc_type: 'interim_announcement',
        name: 'interim_announcement',
        period: { kind: 'fixed', start: '2025-01-01', end: '2025-12-31' },
        reading: 'pages',
      },
    ])
  })

  it('有歧义的要选一份或去掉；期间写法', () => {
    expect(unchosen(request, noChanges).map((each) => each.ref)).toEqual(['i2'])
    expect(unchosen(request, { ...noChanges, dropped: ['i2'] })).toEqual([])
    expect(
      unchosen(request, { ...noChanges, picks: { i2: { material_id: 'a', version_no: 1 } } }),
    ).toEqual([])
    expect(periodOf(request.items[0])).toBe('2025')
    expect(periodOf({ ...request.items[0], key: { doc_type: 'business_rule' } })).toBeNull()
  })
})
