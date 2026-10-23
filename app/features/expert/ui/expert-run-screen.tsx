'use client'

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
import { WorkSidePanel } from '@/components/workbench/side-panel'
import { useConversationEvents } from '@/lib/workbench/conversation-events'
import { byFile, timeline } from '@/lib/workbench/timeline'
import { useClock } from '@/lib/workbench/use-clock'

import { useReview, useRun, useRunActions, useRunStep } from '../api/run'
import { shownStep, tokenOf } from '../model/run'
import { amountText, NowStrip, StepDetail, StepRail } from './parts'
import { ReviewPanel } from './review-panel'

// 专家处理中。三栏：步骤、这一步的细节、委托单。
// 顶上一直摆着：做到第几步、花了多少、现在在干什么、为什么、没有卡住；随时能停。
export function ExpertRunScreen({ task }: { task: string }) {
  const t = useTranslations('expert')
  const { events, state } = useConversationEvents()
  const clock = useClock()
  // 每来一条事件就重取一次：步骤的状态、花了多少、现在在干什么都跟着变
  const beat = events.length
  const run = useRun(task, beat)
  const act = useRunActions(task)
  const [picked, setPicked] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)

  const shown = shownStep(run.data, picked)
  const detail = useRunStep(task, shown, beat)
  // 成稿写在项目文件里（0015）：右边栏「改动」就是产出视图，和工作页同一个
  const line = timeline(events)
  const pending = run.data?.task.active_interaction_id ?? null
  const review = useReview(pending)

  if (!run.data) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {run.isError ? t('failedToLoad') : t('loading')}
      </p>
    )
  }
  const { task: sheet, now, position, steps } = run.data
  const waiting = sheet.state === 'WAITING'
  // 操作权看任务状态。机器断开、实时快照暂缺时仍须能取消。
  const live = ['RECEIVED', 'VALIDATING', 'QUEUED', 'RUNNING', 'WAITING'].includes(sheet.state)
  const offline = now?.doing.code === 'offline'
  // 点了停止、那一轮还没收住：顶上马上说「正在停下」，按钮不再能点，免得以为没点上
  const stopping = live && (sheet.cancel_requested === true || act.stop.isSuccess)
  // 审查面摆在停住的那一步下面；看别的步骤时不摆
  const reviewHere = review.data && shown === (review.data.where.step?.index ?? position?.step)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-sm">
        <span className="w-full min-w-0 truncate font-medium sm:w-auto sm:flex-1">
          {stopping
            ? t('band.stopping')
            : offline
              ? t('band.offline')
              : waiting
                ? t('band.waiting')
                : live
                  ? t('band.running', { name: sheet.expert.name })
                  : (sheet.state_word ?? sheet.expert.name)}
        </span>
        {position ? (
          <span className="text-muted-foreground order-last w-full truncate sm:order-none sm:w-auto sm:max-w-64">
            {t('band.position', { step: position.step, of: position.of, title: position.title })}
          </span>
        ) : null}
        <span className="shrink-0 tabular-nums" data-testid="run-spent">
          {t('band.spent', { amount: amountText(sheet.budget.spent, sheet.budget.currency) })}
          <span className="text-muted-foreground ml-1 text-xs">{t('band.estimated')}</span>
        </span>
        {live ? (
          <Button
            className="shrink-0"
            variant="destructive"
            size="sm"
            disabled={stopping}
            onClick={() => setConfirming(true)}
          >
            {t(stopping ? 'stop.stopping' : 'stop.button')}
          </Button>
        ) : null}
      </header>

      {now ? <NowStrip now={now} clock={clock} /> : null}
      {sheet.chosen_data?.length ? (
        <p
          className="text-muted-foreground shrink-0 truncate border-b px-4 py-1.5 text-xs"
          data-testid="run-data"
        >
          {t('band.data', {
            names: sheet.chosen_data
              .map((each) => t('band.dataItem', { name: each.name, source: each.source }))
              .join(' · '),
          })}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <StepRail steps={steps} shown={shown} onPick={setPicked} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <StepDetail
            step={detail.data ?? steps.find((step) => step.index === shown)}
            loading={detail.isPending}
          />
          {reviewHere && review.data ? (
            <ReviewPanel
              review={review.data}
              token={pending ? tokenOf(events, pending) : null}
              answering={act.answer.isPending}
              failed={act.answer.isError}
              onAnswer={(answer) => {
                const token = pending ? tokenOf(events, pending) : null
                if (pending && token) act.answer.mutate({ pending, token, ...answer })
              }}
            />
          ) : null}
        </div>
        <WorkSidePanel files={byFile(line.changes)} directory={null} live={state === 'live'} />
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('stop.title')}</DialogTitle>
            <DialogDescription>{t('stop.body')}</DialogDescription>
          </DialogHeader>
          {act.stop.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {t('stop.failed')}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t('stop.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={act.stop.isPending}
              onClick={() => act.stop.mutate(undefined, { onSuccess: () => setConfirming(false) })}
            >
              {t('stop.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
