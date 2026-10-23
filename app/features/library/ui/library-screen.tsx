'use client'

import { DownloadIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { clientEnv } from '@/env/client'
import { useWorkbench } from '@/lib/workbench/context'
import { WorkbenchError } from '@/lib/workbench/http'
import { routes } from '@/lib/workbench/routes'

import { downloadHref, useCloudLibrary, useCloudLibraryActions } from '../api/library'
import { ACCEPT, MAX_BYTES, said, sizeText } from '../model/library'

const codeOf = (error: unknown) => (error instanceof WorkbenchError ? error.code : undefined)

// 云端知识库（SDD 0042）：你上传的、托我们代采取回的、从 knowmart 买来的资料。
// 真源在 knowbase，按账号走，在哪台电脑上都一样；专家交回的底稿不在这里（在项目里）。
export function LibraryScreen() {
  const t = useTranslations('library')
  const format = useFormatter()
  const { locale } = useWorkbench()
  const items = useCloudLibrary()
  const { upload, remove } = useCloudLibraryActions()
  const picker = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const listCode = items.isError ? codeOf(items.error) : undefined
  const reauth = said(listCode) === 'reauth'
  const loginUrl = `${clientEnv.NEXT_PUBLIC_API_URL}/auth/web/login?return_to=${encodeURIComponent(routes.library(locale))}`

  function pick(files: FileList | null) {
    const file = files?.[0]
    if (picker.current) picker.current.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) {
      setNotice(t('error.tooLarge'))
      return
    }
    setNotice(null)
    upload.mutate(file, {
      onSuccess: () => setNotice(t('uploaded', { name: file.name })),
      onError: (error) => setNotice(t(`error.${said(codeOf(error))}`)),
    })
  }

  function drop(item: string, name: string) {
    if (!window.confirm(t('confirmRemove', { name }))) return
    remove.mutate(item, {
      onSuccess: () => setNotice(t('removed', { name })),
      onError: (error) => setNotice(t(`error.${said(codeOf(error))}`)),
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('lead')}</p>
          </div>
          <div>
            <input
              ref={picker}
              type="file"
              accept={ACCEPT}
              className="hidden"
              aria-label={t('pick')}
              onChange={(event) => pick(event.target.files)}
            />
            <Button
              type="button"
              size="sm"
              disabled={upload.isPending || reauth}
              onClick={() => picker.current?.click()}
            >
              <UploadIcon className="size-4" />
              {upload.isPending ? t('uploading') : t('upload')}
            </Button>
          </div>
        </header>

        {notice ? (
          <p role="status" className="rounded-lg border px-3 py-2 text-sm">
            {notice}
          </p>
        ) : null}

        {items.isPending ? (
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        ) : items.isError ? (
          <div role="alert" className="text-destructive space-y-2 text-sm">
            <p>{t(`error.${said(listCode)}`)}</p>
            {reauth ? (
              <a href={loginUrl} className="underline underline-offset-3 hover:no-underline">
                {t('signIn')}
              </a>
            ) : null}
          </div>
        ) : items.data.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center">
            <p className="text-base font-medium">{t('empty')}</p>
            <p className="text-muted-foreground mt-1 text-sm">{t('emptyHint')}</p>
          </div>
        ) : (
          <ul className="divide-y rounded-xl border" aria-label={t('title')}>
            {items.data.map((item) => (
              <li
                key={item.item_id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs">
                  {t(`origin.${item.origin}`)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                <span className="text-muted-foreground shrink-0 text-right text-[13px]">
                  {[
                    sizeText(item.size_bytes),
                    format.dateTime(new Date(item.created_at), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="flex shrink-0 gap-1">
                  <a
                    href={downloadHref(item.item_id)}
                    download={item.name}
                    aria-label={t('download', { name: item.name })}
                    className={buttonVariants({ size: 'icon', variant: 'ghost' })}
                  >
                    <DownloadIcon className="size-4" />
                  </a>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('remove', { name: item.name })}
                    disabled={remove.isPending}
                    onClick={() => drop(item.item_id, item.name)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground border-t pt-4 text-xs leading-5">{t('note')}</p>
      </div>
    </div>
  )
}
