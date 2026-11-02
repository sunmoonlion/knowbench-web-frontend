'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { RequestFailure } from '@/components/common/request-failure'
import { TaskDataPanel } from '@/components/workbench/task-data-panel'
import type { BoardCard } from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { routes } from '@/lib/workbench/routes'
import { useTaskData } from '@/lib/workbench/task-data'
import { cn } from '@/lib/utils'

import { useBoard } from '../api/board'

// 等你确认数据、等你定没取到的怎么办：卡片上直接办（用委托页那块数据面板）
const ON_CARD = new Set(['confirm_data', 'decide_missing'])

// 项目的看板（请专家方案设计第 4.8 节）：这个项目的委托按列排，卡片写清等谁、等什么。
export function ProjectBoard({ project }: { project: string }) {
  const t = useTranslations('projects.board')
  const board = useBoard(project, true)
  if (!board.data) {
    if (board.isError)
      return <RequestFailure error={board.error} retry={() => void board.refetch()} />
    return (
      <p className={cn('text-sm', board.isError ? 'text-destructive' : 'text-muted-foreground')}>
        {board.isError ? t('failed') : t('loading')}
      </p>
    )
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-2" data-testid="project-board">
      {board.data.columns.map((column) => (
        <section
          key={column.key}
          aria-label={t(`column.${column.key}`)}
          className="bg-muted/40 w-64 shrink-0 rounded-xl p-2"
        >
          <h3 className="mb-2 px-1 text-xs font-medium">
            {t(`column.${column.key}`)}
            <span className="text-muted-foreground ml-1">{column.cards.length}</span>
          </h3>
          {column.cards.length === 0 ? (
            <p className="text-muted-foreground px-1 text-xs">{t('empty')}</p>
          ) : (
            <ul className="space-y-2">
              {column.cards.map((card) => (
                <Card key={card.task_id} project={project} card={card} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function Card({ project, card }: { project: string; card: BoardCard }) {
  const t = useTranslations('projects.board')
  const { locale } = useWorkbench()
  const here = card.waiting !== null && ON_CARD.has(card.waiting.what)
  return (
    <li className="bg-background rounded-lg border p-2 text-sm" data-testid="board-card">
      <p className="line-clamp-2">{card.question}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {[card.expert, card.state_word].filter(Boolean).join(' · ')}
      </p>
      {card.waiting ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {t(`who.${card.waiting.who}`)}：{t(`what.${card.waiting.what}`)}
        </p>
      ) : null}
      {here ? <CardData task={card.task_id} /> : null}
      <Link
        href={routes.projectConversation(locale, project, card.session_id)}
        className="text-muted-foreground mt-1 inline-block text-xs underline underline-offset-3"
      >
        {t('open')}
      </Link>
    </li>
  )
}

function CardData({ task }: { task: string }) {
  const data = useTaskData(task)
  if (data.isError && !data.data)
    return <RequestFailure error={data.error} retry={() => void data.refetch()} />
  return data.data ? (
    <div className="mt-1.5">
      <TaskDataPanel task={task} data={data.data} compact />
    </div>
  ) : null
}
