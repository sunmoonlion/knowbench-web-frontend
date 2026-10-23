'use client'

import { CheckIcon, XIcon } from 'lucide-react'
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
import { FileTree } from '@/components/workbench/file-tree'
import type { DataNeed } from '@/contracts/workbench-v2'
import { useCloudLibrary } from '@/lib/workbench/cloud-library'
import { cn } from '@/lib/utils'

import {
  baseNameOf,
  cloudFor,
  identityOf,
  pickProblems,
  type Picks,
  takes,
  toggle,
} from '../model/data'

// 专家要的一样数据怎么说：几份、必填还是可选、什么格式
export function NeedLine({ need }: { need: DataNeed }) {
  const t = useTranslations('askExpert.data')
  return (
    <span className="text-muted-foreground text-xs">
      {[
        t(need.required ? 'required' : 'optional'),
        need.min_count === need.max_count
          ? t('countOne', { count: need.min_count })
          : t('count', { min: need.min_count, max: need.max_count }),
        need.formats.map((format) => t(`format.${format}`)).join(' / '),
      ].join(' · ')}
    </span>
  )
}

// 请专家时选数据（SDD 0042 第五节第 6 项）：按声明逐样从云端知识库或本地知识库选。
// 项目里的文件不算（那是产出）；本地知识库只在装着本地 link 的这台电脑上看得到。
export function DataDialog({
  open,
  onOpenChange,
  needs,
  picks,
  onChange,
  environment,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  needs: DataNeed[]
  picks: Picks
  onChange: (picks: Picks) => void
  environment: string | null
}) {
  const t = useTranslations('askExpert.data')
  const [active, setActive] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const need = needs.find((each) => each.key === active) ?? needs[0]
  const cloud = useCloudLibrary()
  const problems = pickProblems(needs, picks)
  if (!need) return null
  const picked = picks[need.key] ?? []
  const chosen = new Set(picked.map(identityOf))

  function pickLocal(path: string) {
    const name = baseNameOf(path)
    if (!takes(need!, name)) {
      setNotice(t('notTaken', { name }))
      return
    }
    const next = toggle(picks, need!, { source: 'local', name, path })
    setNotice(next === picks ? t('full', { max: need!.max_count }) : null)
    onChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogLead')}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] min-h-0 gap-4 sm:grid-cols-[13rem_1fr]">
          <ul className="space-y-1" aria-label={t('title')}>
            {needs.map((each) => {
              const count = (picks[each.key] ?? []).length
              const bad = problems.some((problem) => problem.need.key === each.key)
              return (
                <li key={each.key}>
                  <button
                    type="button"
                    aria-pressed={each.key === need.key}
                    onClick={() => {
                      setActive(each.key)
                      setNotice(null)
                    }}
                    className={cn(
                      'hover:bg-muted/60 w-full rounded-lg border px-3 py-2 text-left',
                      each.key === need.key && 'border-foreground bg-muted/60',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      {each.name}
                      {bad ? null : <CheckIcon className="size-3.5 shrink-0" />}
                    </span>
                    <span className="text-muted-foreground text-xs">{t('picked', { count })}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <section className="min-h-0 space-y-3 overflow-y-auto" aria-label={need.name}>
            <div>
              <p className="text-sm font-medium">{need.name}</p>
              <NeedLine need={need} />
              {need.description ? <p className="mt-1 text-[13px]">{need.description}</p> : null}
              {need.tables.length ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('tables', {
                    tables: need.tables
                      .map((table) =>
                        table.sheet
                          ? `${table.sheet}: ${table.columns.join(', ')}`
                          : table.columns.join(', '),
                      )
                      .join('; '),
                  })}
                </p>
              ) : null}
            </div>

            {picked.length ? (
              <ul
                className="flex flex-wrap gap-1.5"
                aria-label={t('picked', { count: picked.length })}
              >
                {picked.map((each) => (
                  <li
                    key={identityOf(each)}
                    className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
                  >
                    <span className="text-muted-foreground">{t(`source.${each.source}`)}</span>
                    <span className="max-w-48 truncate">{each.name}</span>
                    <button
                      type="button"
                      aria-label={t('remove', { name: each.name })}
                      className="hover:bg-background rounded-full p-0.5"
                      onClick={() => onChange(toggle(picks, need, each))}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs">{t('none')}</p>
            )}
            {notice ? (
              <p role="status" className="text-[13px] text-amber-700 dark:text-amber-400">
                {notice}
              </p>
            ) : null}

            <div>
              <p className="text-muted-foreground mb-1.5 text-xs font-medium">{t('cloud')}</p>
              {cloud.isPending ? (
                <p className="text-muted-foreground text-xs">{t('loading')}</p>
              ) : cloud.isError ? (
                <p className="text-muted-foreground text-xs">{t('cloudFailed')}</p>
              ) : cloudFor(need, cloud.data).length === 0 ? (
                <p className="text-muted-foreground text-xs">{t('cloudEmpty')}</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {cloudFor(need, cloud.data).map((item) => {
                    const on = chosen.has(`cloud:${item.item_id}`)
                    return (
                      <li key={item.item_id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          className="hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]"
                          onClick={() => {
                            const next = toggle(picks, need, {
                              source: 'cloud',
                              name: item.name,
                              item_id: item.item_id,
                            })
                            setNotice(next === picks ? t('full', { max: need.max_count }) : null)
                            onChange(next)
                          }}
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
            </div>

            <div>
              <p className="text-muted-foreground mb-1.5 text-xs font-medium">{t('local')}</p>
              <div className="rounded-lg border p-2 text-[13px]">
                <FileTree
                  environment={environment}
                  directory={null}
                  selected={null}
                  onSelect={pickLocal}
                  scope="library"
                />
              </div>
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
