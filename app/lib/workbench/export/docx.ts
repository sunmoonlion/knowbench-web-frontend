import type { BlockContent, List, Nodes, PhrasingContent, Root, RootContent, Table } from 'mdast'

import { plainText } from './markdown'

// 成稿转 Word（0031）：标题分级、段落、列表、加粗斜体删除线、行内代码、链接、代码块、引用、分隔线、表格。
// docx 库只在点按钮时加载（这个文件整个是按需 import 的）。原始 HTML 当文字。

type Docx = typeof import('docx')

const BODY_FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: '微软雅黑' }
const CODE_FONT = { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: '微软雅黑' }
const SAFE_LINK = /^(https?:|mailto:)/i

type Marks = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean }

export async function markdownToDocx(root: Root, title: string): Promise<Blob> {
  const d: Docx = await import('docx')
  let lists = 0
  const definitions = new Map<string, string>()
  function collect(node: Nodes) {
    if (node.type === 'definition' && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url)
    if ('children' in node) node.children.forEach(collect)
  }
  collect(root)

  const runs = (
    nodes: PhrasingContent[],
    marks: Marks = {},
  ): (InstanceType<Docx['TextRun']> | InstanceType<Docx['ExternalHyperlink']>)[] =>
    nodes.flatMap((node) => {
      switch (node.type) {
        case 'text':
          return [textRun(node.value, marks)]
        case 'strong':
          return runs(node.children, { ...marks, bold: true })
        case 'emphasis':
          return runs(node.children, { ...marks, italics: true })
        case 'delete':
          return runs(node.children, { ...marks, strike: true })
        case 'inlineCode':
          return [textRun(node.value, { ...marks, code: true })]
        case 'break':
          return [new d.TextRun({ break: 1 })]
        case 'link':
        case 'linkReference': {
          const url = node.type === 'link' ? node.url : definitions.get(node.identifier)
          if (!url || !SAFE_LINK.test(url)) return runs(node.children, marks)
          return [
            new d.ExternalHyperlink({
              link: url,
              children: [new d.TextRun({ text: plainText(node), style: 'Hyperlink' })],
            }),
          ]
        }
        case 'footnoteReference':
          return [new d.TextRun({ text: `[${node.label ?? node.identifier}]`, superScript: true })]
        case 'html':
          return [textRun(node.value, marks)]
        default:
          return 'children' in node ? runs(node.children as PhrasingContent[], marks) : []
      }
    })

  const textRun = (text: string, marks: Marks) =>
    new d.TextRun({
      text,
      bold: marks.bold,
      italics: marks.italics,
      strike: marks.strike,
      font: marks.code ? CODE_FONT : undefined,
      shading: marks.code
        ? { type: d.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' }
        : undefined,
    })

  const headings = [
    d.HeadingLevel.HEADING_1,
    d.HeadingLevel.HEADING_2,
    d.HeadingLevel.HEADING_3,
    d.HeadingLevel.HEADING_4,
    d.HeadingLevel.HEADING_5,
    d.HeadingLevel.HEADING_6,
  ]

  const list = (
    node: List,
    level: number,
  ): (InstanceType<Docx['Paragraph']> | InstanceType<Docx['Table']>)[] => {
    const instance = ++lists
    return node.children.flatMap((item) =>
      item.children.flatMap((child, index) => {
        if (child.type === 'paragraph' && index === 0) {
          return [
            new d.Paragraph({
              children: [
                ...(typeof item.checked === 'boolean'
                  ? [textRun(item.checked ? '☑ ' : '☐ ', {})]
                  : []),
                ...runs(child.children),
              ],
              ...(node.ordered
                ? { numbering: { reference: 'ordered', level: Math.min(level, 8), instance } }
                : { bullet: { level: Math.min(level, 8) } }),
            }),
          ]
        }
        if (child.type === 'list') return list(child, level + 1)
        return blocks([child as RootContent], level + 1)
      }),
    )
  }

  const table = (node: Table) => {
    const align = node.align ?? []
    return new d.Table({
      width: { size: 100, type: d.WidthType.PERCENTAGE },
      rows: node.children.map(
        (row, r) =>
          new d.TableRow({
            tableHeader: r === 0,
            children: row.children.map(
              (cell, c) =>
                new d.TableCell({
                  shading:
                    r === 0
                      ? { type: d.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' }
                      : undefined,
                  children: [
                    new d.Paragraph({
                      alignment:
                        align[c] === 'right'
                          ? d.AlignmentType.RIGHT
                          : align[c] === 'center'
                            ? d.AlignmentType.CENTER
                            : d.AlignmentType.LEFT,
                      children: runs(cell.children, { bold: r === 0 }),
                    }),
                  ],
                }),
            ),
          }),
      ),
    })
  }

  const blocks = (
    nodes: (RootContent | BlockContent)[],
    indent = 0,
  ): (InstanceType<Docx['Paragraph']> | InstanceType<Docx['Table']>)[] =>
    nodes.flatMap((node) => {
      const left = indent ? { indent: { left: 360 * indent } } : {}
      switch (node.type) {
        case 'heading':
          return [
            new d.Paragraph({ heading: headings[node.depth - 1], children: runs(node.children) }),
          ]
        case 'paragraph':
          return [new d.Paragraph({ ...left, children: runs(node.children) })]
        case 'list':
          return list(node, indent)
        case 'table':
          return [table(node), new d.Paragraph({})]
        case 'code':
          return node.value.split('\n').map(
            (line) =>
              new d.Paragraph({
                ...left,
                shading: { type: d.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' },
                children: [new d.TextRun({ text: line, font: CODE_FONT })],
              }),
          )
        case 'blockquote':
          return blocks(node.children, indent + 1).map((p) => p)
        case 'thematicBreak':
          return [
            new d.Paragraph({
              border: {
                bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 },
              },
              children: [],
            }),
          ]
        case 'html':
          return [new d.Paragraph({ ...left, children: [new d.TextRun({ text: node.value })] })]
        case 'footnoteDefinition':
          return [
            new d.Paragraph({
              ...left,
              children: [
                new d.TextRun({ text: `[${node.label ?? node.identifier}] `, superScript: true }),
                ...node.children.flatMap((child) =>
                  child.type === 'paragraph' ? runs(child.children) : [],
                ),
              ],
            }),
          ]
        default:
          return []
      }
    })

  const doc = new d.Document({
    title,
    creator: 'SunMoonAI',
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 21 },
          paragraph: { spacing: { after: 120, line: 300 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: d.LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: d.AlignmentType.START,
            style: { paragraph: { indent: { left: 420 * (level + 1), hanging: 300 } } },
          })),
        },
      ],
    },
    sections: [{ children: blocks(root.children) }],
  })
  return d.Packer.toBlob(doc)
}
