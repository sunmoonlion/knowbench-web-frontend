'use client'

import { CheckIcon, LibraryIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCloudLibrary } from '@/lib/workbench/cloud-library'
import { WorkbenchError } from '@/lib/workbench/http'
import { useChooseSessionCloudData, useSessionCloudData } from '@/lib/workbench/session-cloud-data'
import { cn } from '@/lib/utils'

// 读得成文字的几种：与 knowbase 收的一致（PDF、Excel、CSV、文本）
const READABLE =
  /^(application\/pdf|application\/vnd\.(openxmlformats-officedocument\.spreadsheetml\.sheet|ms-excel)|text\/(csv|plain|markdown))\b/

// 输入框旁「云端知识库」（SDD 0042 第四节）：这段对话选用云端知识库里的几份，模型只读这几份。
// 凭「会话」运行授权，改选就换，到期要再选。
export function CloudDataButton({
  session,
  disabled = false,
}: {
  session: string | null
  disabled?: boolean
}) {
  const t = useTranslations('cloudData')
  const current = useSessionCloudData(session)
  const choose = useChooseSessionCloudData(session)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[] | null>(null)
  const cloud = useCloudLibrary()
  const chosen = current.data?.items ?? []
  const selection = picked ?? chosen.map((each) => each.item_id)
  const items = (cloud.data ?? []).filter((item) => READABLE.test(item.media_type))
  const code = choose.isError ? (choose.error as WorkbenchError).code : null

  async function save() {
    try {
      await choose.mutateAsync(selection)
      setOpen(false)
      setPicked(null)
    } catch {
      // 原因显示在对话框里
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || session === null}
        title={chosen.length ? chosen.map((each) => each.name).join('\n') : undefined}
        onClick={() => {
          setPicked(null)
          choose.reset()
          setOpen(true)
        }}
      >
        <LibraryIcon className="size-3.5" />
        {chosen.length ? t('buttonWith', { count: chosen.length }) : t('button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('lead')}</DialogDescription>
          </DialogHeader>
          {cloud.isPending ? (
            <p className="text-muted-foreground text-sm">{t('loading')}</p>
          ) : cloud.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {t('failed')}
            </p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : (
            <ul
              className="max-h-80 divide-y overflow-y-auto rounded-lg border"
              aria-label={t('title')}
            >
              {items.map((item) => {
                const on = selection.includes(item.item_id)
                return (
                  <li key={item.item_id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      className="hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]"
                      onClick={() =>
                        setPicked(
                          on
                            ? selection.filter((each) => each !== item.item_id)
                            : [...selection, item.item_id],
                        )
                      }
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border',
                          on && 'bg-foreground text-background',
                        )}
                      >
                        {on ? <CheckIcon className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">{t('note')}</p>
          {code ? (
            <p role="alert" className="text-destructive text-[13px]">
              {t.has(`problem.${code}`) ? t(`problem.${code}`) : t('problem.other')}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={choose.isPending || selection.length > 20}
              onClick={() => void save()}
            >
              {choose.isPending ? t('saving') : t('save', { count: selection.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
