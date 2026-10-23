'use client'

import {
  ChevronLeftIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  LoaderIcon,
  PrinterIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type RefObject, useMemo, useRef, useState } from 'react'

import { Markdown } from '@/components/common/markdown'
import { Button } from '@/components/ui/button'
import { exportExcel, exportWord, hasTables, printRendered } from '@/lib/workbench/export/actions'
import { baseName, decodeText, isMarkdown, sizeText } from '@/lib/workbench/file-tree'
import { isRemote, type LinkHandle } from '@/lib/workbench/local-agent'
import { useLocalFile } from '@/lib/workbench/queries'

import { ServiceProblem } from './file-tree'

// 点开一个文件看内容（0022 乙案；在装有本地 link 的电脑上直接从本机读、不经云端，在远程登录 link 的电脑上经工作台转发，账 165）：≤ 1 MiB 的文本直接看，Markdown 渲染；二进制只给大小。只读。
// 完整读到的 Markdown 可以导出成 Word、Excel（只含表格）、PDF（0031），都在浏览器里做。
export function FileView({
  agent,
  path,
  onBack,
}: {
  agent: LinkHandle
  path: string
  onBack: () => void
}) {
  const t = useTranslations('work')
  const file = useLocalFile(agent, path)
  const decoded = useMemo(() => (file.data ? decodeText(file.data.bytes) : null), [file.data])
  const rendered = useRef<HTMLDivElement>(null)
  const exportable =
    isMarkdown(path) && file.data?.eof && decoded && !('binary' in decoded) ? decoded.text : null
  return (
    <section aria-label={baseName(path)} className="flex h-full min-h-0 flex-col">
      <header className="mb-2 flex items-center gap-1">
        <Button variant="ghost" size="icon-xs" aria-label={t('files.back')} onClick={onBack}>
          <ChevronLeftIcon />
        </Button>
        <span className="truncate font-medium" title={path}>
          {baseName(path)}
        </span>
        {file.data ? (
          <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
            {sizeText(file.data.size)}
          </span>
        ) : null}
      </header>
      {isRemote(agent) ? (
        <p className="text-muted-foreground mb-2 text-xs leading-5">{t('files.remoteNote')}</p>
      ) : null}
      {exportable !== null ? <ExportBar text={exportable} path={path} rendered={rendered} /> : null}
      {file.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2">
          <LoaderIcon className="size-3.5 animate-spin" />
          {t('files.loading')}
        </p>
      ) : file.isError ? (
        <ServiceProblem error={file.error} />
      ) : decoded && 'binary' in decoded ? (
        <p className="text-muted-foreground leading-6">{t('files.binary')}</p>
      ) : decoded ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {isMarkdown(path) ? (
            <div ref={rendered}>
              <Markdown>{decoded.text}</Markdown>
            </div>
          ) : (
            <pre className="font-mono text-xs leading-5 whitespace-pre-wrap">{decoded.text}</pre>
          )}
          {!file.data.eof ? (
            <p className="text-muted-foreground mt-2 text-xs">{t('files.partial')}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function ExportBar({
  text,
  path,
  rendered,
}: {
  text: string
  path: string
  rendered: RefObject<HTMLDivElement | null>
}) {
  const t = useTranslations('work.files.export')
  const [busy, setBusy] = useState<'word' | 'excel' | null>(null)
  const [failed, setFailed] = useState(false)
  const tables = useMemo(() => hasTables(text), [text])
  const run = async (kind: 'word' | 'excel') => {
    setBusy(kind)
    setFailed(false)
    try {
      if (kind === 'word') await exportWord(text, path)
      else await exportExcel(text, path, { sheetSource: t('sheetSource'), notes: t('notes') })
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <Button variant="outline" size="xs" disabled={busy !== null} onClick={() => run('word')}>
        {busy === 'word' ? <LoaderIcon className="animate-spin" /> : <FileTextIcon />}
        {t('word')}
      </Button>
      <Button
        variant="outline"
        size="xs"
        disabled={busy !== null || !tables}
        title={tables ? undefined : t('noTables')}
        onClick={() => run('excel')}
      >
        {busy === 'excel' ? <LoaderIcon className="animate-spin" /> : <FileSpreadsheetIcon />}
        {t('excel')}
      </Button>
      <Button
        variant="outline"
        size="xs"
        disabled={busy !== null}
        onClick={() => rendered.current && printRendered(rendered.current, path)}
      >
        <PrinterIcon />
        {t('pdf')}
      </Button>
      {failed ? <span className="text-destructive text-xs">{t('failed')}</span> : null}
    </div>
  )
}
