'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useSyncExternalStore } from 'react'

import { ChatScreen } from '@/features/chat'
import { ExpertRunScreen } from '@/features/expert'
import { CostLine } from '@/features/usage'
import { WorkScreen } from '@/features/work'
import { useConversation } from '@/lib/workbench/conversation'
import { useConversationEvents } from '@/lib/workbench/conversation-events'
import { useWorkbench } from '@/lib/workbench/context'
import { summonedOf } from '@/lib/workbench/find-expert'
import { routes } from '@/lib/workbench/routes'

const TURNING = new Set(['wheel/handover', 'wheel/return', 'task/state'])
const noSubscription = () => () => {}

// 项目里的一段对话。专家正拿着的时候是专家处理中那一页；否则是聊天就用聊天页，是工作就用工作页。
export function ConversationView({ conversation }: { conversation: string }) {
  const found = useConversation(conversation)
  const { events } = useConversationEvents()
  const client = useQueryClient()
  // 交给专家、专家交回：谁在处理变了，重新取一次这段对话
  const turns = events.filter((event) => TURNING.has(event.type)).length
  useEffect(() => {
    if (turns > 0) void client.invalidateQueries({ queryKey: ['workbench', 'conversation'] })
  }, [turns, client])

  const cost = <CostLine conversation={conversation} />
  if (found.data?.active_task_id) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {found.data.project_id ? (
          <SummonedNote conversation={conversation} project={found.data.project_id} />
        ) : null}
        <div className="min-h-0 flex-1">
          <ExpertRunScreen task={found.data.active_task_id} />
        </div>
      </div>
    )
  }
  if (found.data?.kind === 'chat') {
    return <ChatScreen conversation={conversation} cost={cost} />
  }
  // 还没取到是哪一种的时候先按工作页摆：项目里的对话多数是工作
  return <WorkScreen conversation={conversation} cost={cost} />
}

// AI 替你请的专家（请专家方案设计第 4.9 节）：照实写请了谁、为什么，可以换一位。
// 只在这个浏览器里记着；换了浏览器就不显示这一行，专家照常做。
function SummonedNote({ conversation, project }: { conversation: string; project: string }) {
  const t = useTranslations('findExpert')
  const { locale } = useWorkbench()
  const raw = useSyncExternalStore(
    noSubscription,
    () => JSON.stringify(summonedOf(conversation)),
    () => 'null',
  )
  const summoned = JSON.parse(raw) as { name: string; reason: string } | null
  if (!summoned) return null
  return (
    <p role="note" className="bg-muted/50 shrink-0 border-b px-4 py-2 text-[13px]">
      {t('summonedBanner', { name: summoned.name, reason: summoned.reason })}{' '}
      <Link
        href={routes.askExpert(locale, project, conversation)}
        className="underline underline-offset-3"
      >
        {t('change')}
      </Link>
    </p>
  )
}
