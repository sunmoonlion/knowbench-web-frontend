import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { exportName } from '@/lib/workbench/export/actions'
import { markdownToDocx } from '@/lib/workbench/export/docx'
import { numberOf, parseMarkdown, plainText, tablesOf } from '@/lib/workbench/export/markdown'
import { sheetNames, tablesToXlsx } from '@/lib/workbench/export/xlsx'

// 成稿导出（0031）：Markdown 转 Word、表格转 Excel 都在浏览器里做，只换格式不改数。

// jsdom 的 Blob 没有 arrayBuffer()，用 FileReader 读
const bytes = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })

const NOTE = `# 贵州茅台 2024 年报摘要

结论栏留给你。数据来自**我上传的年报**，见 [巨潮](https://www.cninfo.com.cn)。

## 利润表

| 科目 | 2023-12-31 | 2024-12-31 |
| :--- | ---: | ---: |
| 营业收入 | 150,560.33 | 174,144.07[^1] |
| 营业成本 | (12,000) | −13,500 |
| 毛利率 | 91.5% | — |

## 资产负债表

| 科目 | 2024-12-31 |
| --- | --- |
| 货币资金 | 59,296.10 |

1. 第一点
2. 第二点
   - 小点

> 局限：未审计。

\`\`\`
SELECT 1
\`\`\`

[^1]: 年报第 5 页。
`

describe('reading tables out of a deliverable', () => {
  it('names each table after the heading before it and keeps cells as written', () => {
    const tables = tablesOf(parseMarkdown(NOTE))
    expect(tables.map((t) => t.name)).toEqual(['利润表', '资产负债表'])
    expect(tables[0].header).toEqual(['科目', '2023-12-31', '2024-12-31'])
    expect(tables[0].rows[0]).toEqual(['营业收入', '150,560.33', '174,144.07'])
    expect(tables[0].rows[2]).toEqual(['毛利率', '91.5%', '—'])
  })

  it('falls back to 表 n without a heading', () => {
    expect(tablesOf(parseMarkdown('| a |\n| - |\n| 1 |')).map((t) => t.name)).toEqual(['表 1'])
  })

  it.each([
    ['150,560.33', 150560.33, false],
    ['(12,000)', -12000, false],
    ['−13,500', -13500, false],
    ['１２', null, false],
    ['91.5%', 0.915, true],
    ['—', null, false],
    ['N/A', null, false],
    ['', null, false],
    ['1e3', 1000, false],
    ['12 亿', null, false],
  ] as const)('reads %j conservatively', (raw, value, percent) => {
    const got = numberOf(raw)
    if (value === null) expect(got).toBeNull()
    else expect(got).toEqual({ value: expect.closeTo(value, 10), percent })
  })

  it('plain text leaves footnote marks out', () => {
    const [table] = tablesOf(parseMarkdown(NOTE))
    expect(plainText(parseMarkdown('a[^1]\n\n[^1]: x').children[0])).toBe('a')
    expect(table.rows[0][2]).toBe('174,144.07')
  })
})

describe('Excel', () => {
  it('keeps sheet names legal and unique', () => {
    expect(sheetNames(['利润表', '利润表', 'a/b:c*?[d]', '', 'x'.repeat(40)])).toEqual([
      '利润表',
      '利润表(2)',
      'a b c d',
      '表 4',
      'x'.repeat(31),
    ])
  })

  it('writes one sheet per table with numbers as numbers and a source sheet', async () => {
    const blob = await tablesToXlsx(tablesOf(parseMarkdown(NOTE)), {
      path: 'C:/proj/底稿/成稿.md',
      exportedAt: new Date('2026-10-17T10:00:00Z'),
      sheetSource: '出处',
      notes: '按成稿原样导出，数没有改动。',
    })
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await bytes(blob))
    expect(book.worksheets.map((s) => s.name)).toEqual(['利润表', '资产负债表', '出处'])
    const income = book.getWorksheet('利润表')!
    expect(income.getRow(1).values).toEqual([undefined, '科目', '2023-12-31', '2024-12-31'])
    expect(income.getCell('B2').value).toBe(150560.33)
    expect(income.getCell('B3').value).toBe(-12000)
    expect(income.getCell('B4').value).toBeCloseTo(0.915)
    expect(income.getCell('B4').numFmt).toBe('0.00%')
    expect(income.getCell('C4').value).toBe('—')
    expect(book.getWorksheet('出处')!.getCell('B1').value).toBe('C:/proj/底稿/成稿.md')
  })
})

describe('Word', () => {
  it('turns headings, tables, lists, links and footnotes into a docx', async () => {
    const blob = await markdownToDocx(parseMarkdown(NOTE), '成稿')
    const zip = await JSZip.loadAsync(await bytes(blob))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('贵州茅台 2024 年报摘要')
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('174,144.07')
    expect(xml).toContain('第二点')
    expect(xml).toContain('SELECT 1')
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>/)
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(rels).toContain('https://www.cninfo.com.cn')
    const styles = await zip.file('word/styles.xml')!.async('string')
    expect(styles).toContain('微软雅黑')
  })

  it('does not turn unsafe links into hyperlinks', async () => {
    const blob = await markdownToDocx(parseMarkdown('[x](javascript:alert(1))'), 'x')
    const zip = await JSZip.loadAsync(await bytes(blob))
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(rels).not.toContain('javascript:')
  })
})

describe('file names', () => {
  it('drops the markdown extension', () => {
    expect(exportName('C:\\proj\\底稿\\财务分析与预测-成稿.md')).toBe('财务分析与预测-成稿')
    expect(exportName('/a/b/notes.markdown')).toBe('notes')
  })
})

const source = { path: 'report.md', exportedAt: new Date(0), sheetSource: '出处', notes: '核查' }
it('preserves identifiers and non-numeric cells in the delivered workbook', async () => {
  const markdown =
    '| 代码 | 凭证号 | 两项 | 原文 |\n|---|---|---|---|\n|000858|9007199254740993|1,2|3 4|'
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await bytes(await tablesToXlsx(tablesOf(parseMarkdown(markdown)), source)))
  expect(book.worksheets[0].getRow(2).values).toEqual([
    undefined,
    '000858',
    '9007199254740993',
    '1,2',
    '3 4',
  ])
})
it.each(['History', "'利润表'"])('exports a valid Markdown heading %s', async (name) => {
  await expect(
    tablesToXlsx([{ name, header: ['x'], rows: [['1']] }], source),
  ).resolves.toBeInstanceOf(Blob)
})
it('retains the evidence URL of a reference-style link in Word', async () => {
  const doc = await markdownToDocx(
    parseMarkdown('见[核验原文][report]。\n\n[report]: https://example.org/annual'),
    'test',
  )
  const zip = await JSZip.loadAsync(await bytes(doc))
  expect(await zip.file('word/document.xml')!.async('string')).toContain('核验原文')
  expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain(
    'example.org/annual',
  )
})
it('exports completed and outstanding checklist items with distinct checkmarks', async () => {
  const render = async (text: string) => {
    const zip = await JSZip.loadAsync(
      await bytes(await markdownToDocx(parseMarkdown(text), 'test')),
    )
    return (await zip.file('word/document.xml')!.async('string')).split('<w:body>')[1]
  }
  expect(await render('- [x] 核对余额')).toContain('☑')
  expect(await render('- [ ] 核对余额')).toContain('☐')
})
