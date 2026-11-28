import { type ExportTable, numberOf } from './markdown'

// 成稿里的表转 Excel（0031）：一张表一张工作表，能读成数的格子存成数（百分数按百分比格式），其余原样；
// 最后一张「出处」写文件与导出时间。exceljs 只在点按钮时加载。

const BAD_SHEET_CHARS = /[[\]:*?/\\]/g

/** Excel 的工作表名：去掉不许的字符，最多 31 个字，重名加 (2)、(3)。 */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw, i) => {
    const cleaned = (
      raw.replace(BAD_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim() || `表 ${i + 1}`
    ).slice(0, 31)
    const title = cleaned.replace(/^'+|'+$/g, '').trim()
    const base = /^history$/i.test(title) ? title + ' (1)' : title || `表 ${i + 1}`
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = `(${n})`
      name = base.slice(0, 31 - suffix.length) + suffix
    }
    used.add(name.toLowerCase())
    return name
  })
}

/** 列宽按最长的一格估（中文算两格宽），8 到 60 之间。 */
function widthOf(values: string[]): number {
  const longest = Math.max(
    0,
    ...values.map((v) => [...v].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)),
  )
  return Math.min(60, Math.max(8, longest + 2))
}

export async function tablesToXlsx(
  tables: ExportTable[],
  source: { path: string; exportedAt: Date; sheetSource: string; notes: string },
): Promise<Blob> {
  const { Workbook } = (await import('exceljs')).default ?? (await import('exceljs'))
  const book = new Workbook()
  book.creator = 'SunMoonAI'
  book.created = source.exportedAt
  const names = sheetNames([...tables.map((t) => t.name), source.sheetSource])
  tables.forEach((table, index) => {
    const sheet = book.addWorksheet(names[index], { views: [{ state: 'frozen', ySplit: 1 }] })
    const header = sheet.addRow(table.header)
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
    })
    const identifiers = table.header.map((title) =>
      /(?:代码|编号|凭证号|证券号|(?:^|[ _-])(?:id|code|identifier|serial)(?:$|[ _-]))/i.test(
        title,
      ),
    )
    for (const values of table.rows) {
      const row = sheet.addRow(
        values.map((raw, c) => {
          const parsed = identifiers[c] ? null : numberOf(raw)
          return parsed ? parsed.value : raw
        }),
      )
      values.forEach((raw, c) => {
        if (!identifiers[c] && numberOf(raw)?.percent) row.getCell(c + 1).numFmt = '0.00%'
      })
    }
    const columns = Math.max(table.header.length, ...table.rows.map((r) => r.length))
    for (let c = 0; c < columns; c++) {
      sheet.getColumn(c + 1).width = widthOf([
        table.header[c] ?? '',
        ...table.rows.map((r) => r[c] ?? ''),
      ])
    }
  })
  const info = book.addWorksheet(names[tables.length])
  info.addRows([
    ['文件', source.path],
    ['导出时间', source.exportedAt.toLocaleString('zh-CN', { hour12: false })],
    ['说明', source.notes],
  ])
  info.getColumn(1).width = 12
  info.getColumn(2).width = 80
  const buffer = await book.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
