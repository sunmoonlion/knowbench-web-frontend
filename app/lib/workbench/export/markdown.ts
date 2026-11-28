import type { Nodes, Root, RootContent, Table } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

// 成稿导出（0031）：先把 Markdown 解析成语法树，Word 与 Excel 都从这棵树转。与网页渲染同一套 GFM 规则（remark-gfm）。

export function parseMarkdown(text: string): Root {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

/** 一个节点里的纯文字（脚注引用不算：它在 Word 里另起，在 Excel 的格子里是噪音）。 */
export function plainText(node: Nodes): string {
  if (node.type === 'footnoteReference') return ''
  if (node.type === 'break') return '\n'
  if ('value' in node && typeof node.value === 'string') return node.value
  if ('children' in node) return (node.children as Nodes[]).map(plainText).join('')
  return ''
}

export type ExportTable = { name: string; header: string[]; rows: string[][] }

/** 文件里的每张表，名字取它前面最近的标题；没有标题就叫「表 n」。 */
export function tablesOf(root: Root): ExportTable[] {
  const found: ExportTable[] = []
  let heading = ''
  const visit = (nodes: RootContent[]) => {
    for (const node of nodes) {
      if (node.type === 'heading') heading = plainText(node).trim()
      else if (node.type === 'table') found.push(tableOf(node, heading || `表 ${found.length + 1}`))
      else if (node.type === 'blockquote' || node.type === 'listItem' || node.type === 'list')
        visit(node.children as RootContent[])
    }
  }
  visit(root.children)
  return found
}

function tableOf(table: Table, name: string): ExportTable {
  const [head, ...body] = table.children
  const cells = (row: Table['children'][number]) =>
    row.children.map((cell) => plainText(cell).trim())
  return { name, header: head ? cells(head) : [], rows: body.map(cells) }
}

/**
 * 格子能读成数就回数，读不成回 null。认千分位（含全角逗号）、括号负数、全角与 Unicode 负号、百分号（回小数并标出）；
 * 不猜单位，「—」「-」「N/A」与空白都不是数。和 knowlab 读表格的规则一致（0030 §3.1）。
 */
export function numberOf(raw: string): { value: number; percent: boolean } | null {
  let text = raw.trim().replace(/，/g, ',').replace(/[−－]/g, '-')
  if (!text) return null
  let negative = false
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true
    text = text.slice(1, -1)
  }
  const percent = text.endsWith('%')
  if (percent) text = text.slice(0, -1)
  if (
    !/^[+-]?(?:(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)
  )
    return null
  if (negative && /^[+-]/.test(text)) return null
  const numeric = text.replace(/,/g, '')
  const mantissa = numeric
    .split(/e/i)[0]
    .replace(/[+.\-]/g, '')
    .replace(/^0+|0+$/g, '')
  let value = Number(numeric)
  if (
    mantissa.length > 15 ||
    !Number.isFinite(value) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
    (value === 0 && mantissa !== '')
  )
    return null
  if (negative) value = -value
  return { value: percent ? value / 100 : value, percent }
}
