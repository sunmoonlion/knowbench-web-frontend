'use client'

import { useTranslations } from 'next-intl'
import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { directAnswerOf, useAskIncubation } from '@/lib/workbench/find-expert'

const noSubscription = () => () => {}

// 找专家没找到、用户让自己的模型直接答的那段对话（请专家方案设计第 4.9 节）：顶上照实说不是专家答的；
// 还记得是哪一轮找专家来的，就能接着点「孵化一个专家」，这份回答附过去作参考。
export function DirectAnswerNote({ conversation }: { conversation: string }) {
  const t = useTranslations('findExpert')
  const task = useSyncExternalStore(
    noSubscription,
    () => directAnswerOf(conversation)?.task ?? null,
    () => null,
  )
  const incubate = useAskIncubation(task ?? '')
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-amber-50 px-4 py-2 text-[13px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <span className="min-w-0 flex-1">{t('directBanner')}</span>
      {task ? (
        incubate.isSuccess ? (
          <span role="status">{t('incubated', { title: incubate.data.title ?? '' })}</span>
        ) : (
          <Button
            size="xs"
            variant="outline"
            disabled={incubate.isPending}
            onClick={() => incubate.mutate(conversation)}
          >
            {t('incubateWithAnswer')}
          </Button>
        )
      ) : null}
      {incubate.isError ? (
        <span role="alert" className="text-destructive w-full">
          {t('actionFailed')}
        </span>
      ) : null}
    </div>
  )
}
