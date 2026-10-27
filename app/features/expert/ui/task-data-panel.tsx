'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import type { TaskData } from '@/contracts/workbench-v2'

// 清单 v2 的专家（SDD 0043、0048）：这件委托用的数据。等数据时说在等哪几项、走到哪；
// 专家运行中新要了什么，等用户确认去取，或者不要、照现有的接着做（模型不能替用户确认）。
export function TaskDataPanel({
  data,
  onConfirm,
  onDecline,
  busy,
  failed,
}: {
  data: TaskData
  onConfirm: () => void
  onDecline: () => void
  busy: boolean
  failed: boolean
}) {
  const t = useTranslations('expert.data')
  if (!data.listed) return null
  const pending = data.requests.filter((each) => each.status === 'pending')
  const asked = pending.flatMap((each) => each.labels)

  return (
    <section
      aria-label={t('title')}
      className="shrink-0 space-y-1 border-b px-4 py-2 text-[13px]"
      data-testid="task-data"
    >
      {data.status === 'waiting' ? (
        <p className="text-amber-700 dark:text-amber-400">
          {data.waiting_for.length
            ? t('waiting', { items: data.waiting_for.join('、') })
            : t('waitingPlain')}
          {data.demand_status ? (
            <span className="text-muted-foreground ml-2">
              {t('demand', { status: data.demand_status })}
            </span>
          ) : null}
        </p>
      ) : null}
      {data.status === 'failed' && data.reason ? (
        <p role="alert" className="text-destructive">
          {t('failed', { reason: data.reason })}
        </p>
      ) : null}
      {asked.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-amber-700 dark:text-amber-400">
            {t('requested', { items: asked.join('、') })}
          </p>
          <Button size="sm" disabled={busy} onClick={onConfirm}>
            {busy ? t('confirming') : t('confirm')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onDecline}>
            {t('decline')}
          </Button>
          {failed ? (
            <span role="alert" className="text-destructive">
              {t('problem')}
            </span>
          ) : null}
        </div>
      ) : null}
      {data.incomplete.length ? (
        <p className="text-muted-foreground">
          {t('incomplete', { items: data.incomplete.join('；') })}
        </p>
      ) : null}
      {data.pinned.length ? (
        <p className="text-muted-foreground truncate">
          {t('pinned', {
            count: data.pinned.length,
            names: data.pinned.map((each) => each.name).join(' · '),
          })}
        </p>
      ) : null}
    </section>
  )
}
