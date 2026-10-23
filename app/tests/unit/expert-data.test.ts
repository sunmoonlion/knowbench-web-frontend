// 请专家时按数据需求声明选数据（SDD 0042 第五节第 6 项）的规则
import { describe, expect, it } from 'vitest'

import type { DataNeed } from '@/contracts/workbench-v2'
import {
  baseNameOf,
  choicesOf,
  cloudFor,
  formatOfName,
  formatOfType,
  pickProblems,
  picksFromLast,
  takes,
  toggle,
} from '@/features/expert/model/data'

const reports: DataNeed = {
  key: 'annual_reports',
  name: '年报',
  description: '',
  formats: ['pdf'],
  required: true,
  min_count: 1,
  max_count: 2,
  tables: [],
}
const tables: DataNeed = {
  ...reports,
  key: 'statements',
  name: '三张报表',
  formats: ['excel', 'csv'],
  required: false,
}
const a = { source: 'cloud' as const, name: 'a.pdf', item_id: 'i1' }
const b = { source: 'local' as const, name: 'b.pdf', path: 'C:\\kb\\b.pdf' }
const c = { source: 'local' as const, name: 'c.pdf', path: 'C:\\kb\\c.pdf' }

describe('选数据', () => {
  it('按文件名、内容类型认格式', () => {
    expect(formatOfName('2024 年报.PDF')).toBe('pdf')
    expect(formatOfName('表.xls')).toBe('excel')
    expect(formatOfName('说明.docx')).toBeNull()
    expect(formatOfType('text/csv; charset=utf-8')).toBe('csv')
    expect(formatOfType('image/png')).toBeNull()
    expect(baseNameOf('C:\\kb\\2024\\年报.pdf')).toBe('年报.pdf')
    expect(baseNameOf('/home/u/kb/年报.pdf')).toBe('年报.pdf')
    expect(takes(tables, 'b.csv')).toBe(true)
    expect(takes(tables, 'b.pdf')).toBe(false)
  })

  it('点一下加上、再点拿掉，到上限不再加', () => {
    let picks = toggle({}, reports, a)
    picks = toggle(picks, reports, b)
    expect(toggle(picks, reports, c)).toBe(picks)
    expect(toggle(picks, reports, a).annual_reports).toEqual([b])
  })

  it('必填的不够数不能开始；可选的不选可以，选了要在范围里', () => {
    expect(pickProblems([reports, tables], {}).map((p) => p.need.key)).toEqual(['annual_reports'])
    expect(pickProblems([reports, tables], { annual_reports: [a] })).toEqual([])
    expect(
      pickProblems([reports, { ...tables, min_count: 2 }], {
        annual_reports: [a],
        statements: [b],
      }).map((p) => p.need.key),
    ).toEqual(['statements'])
  })

  it('上次选的按这一版的声明放回去；交给后端按声明的次序', () => {
    const picks = picksFromLast(
      [reports, tables],
      [
        { need: 'statements', source: 'local', name: 'x.csv', path: 'C:\\kb\\x.csv' },
        { need: 'gone', source: 'cloud', name: 'old.pdf', item_id: 'i0' },
        { need: 'annual_reports', source: 'cloud', name: 'a.pdf', item_id: 'i1' },
      ],
    )
    expect(Object.keys(picks).sort()).toEqual(['annual_reports', 'statements'])
    expect(choicesOf([reports, tables], picks)).toEqual([
      { need: 'annual_reports', source: 'cloud', name: 'a.pdf', item_id: 'i1' },
      { need: 'statements', source: 'local', name: 'x.csv', path: 'C:\\kb\\x.csv' },
    ])
  })

  it('云端知识库里只列格式对得上的', () => {
    const item = (name: string, media_type: string) => ({
      item_id: name,
      name,
      media_type,
      size_bytes: 1,
      sha256: 'a'.repeat(64),
      origin: 'upload',
      created_at: '2026-10-23T12:00:00Z',
    })
    const items = [item('a.pdf', 'application/pdf'), item('b.csv', 'text/csv; charset=utf-8')]
    expect(cloudFor(reports, items as never).map((each) => each.name)).toEqual(['a.pdf'])
    expect(cloudFor(tables, items as never).map((each) => each.name)).toEqual(['b.csv'])
  })
})
