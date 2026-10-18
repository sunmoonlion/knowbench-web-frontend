'use client'

import { MessageSquareIcon, WrenchIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConversationTitle } from '@/components/workbench/conversation-title'
import { WorkSidePanel } from '@/components/workbench/side-panel'
import { useWorkbench } from '@/lib/workbench/context'
import { money, symbol, toMicros } from '@/lib/workbench/money'
import { useProjectDetail } from '@/lib/workbench/queries'
import { routes } from '@/lib/workbench/routes'
import { cn } from '@/lib/utils'

import { useProjectActions } from '../api/projects'

function amount(value: string, currency: string) {
  const micros = toMicros(value)
  return micros === null ? value : `${symbol(currency)}${money(micros)}`
}

// 项目页：一个项目里的东西都在这。对话、专家交回；三种开始的办法；改名、归档。成稿在项目文件里（0015）。
// 不显示文件列表：文件在用户的机器上，第一期不做远程浏览。
export function ProjectScreen({ project: id }: { project: string }) {
  const t = useTranslations('projects.page')
  const format = useFormatter()
  const { locale } = useWorkbench()
  const detail = useProjectDetail(id)
  const act = useProjectActions()
  const [archiving, setArchiving] = useState(false)

  if (!detail.data) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {detail.isError ? t('failed') : t('loading')}
      </p>
    )
  }
  const { project, conversations, tasks } = detail.data
  const offline = !project.online
  const closed = project.archived
  const start = (mode: 'chat' | 'work') =>
    `${routes.home(locale)}?mode=${mode}&project=${encodeURIComponent(id)}`
  const off = 'pointer-events-none opacity-50'
  const heading = 'mb-2 text-sm font-medium'
  const when = (at: string | null) =>
    at ? format.dateTime(new Date(at), { dateStyle: 'medium', timeStyle: 'short' }) : ''

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
          <header className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 [&_button]:text-2xl [&_button]:font-semibold">
                <ConversationTitle
                  title={project.title}
                  onRename={(title) => act.rename.mutate({ project: id, title })}
                />
              </div>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  closed ? act.archive.mutate({ project: id, archived: false }) : setArchiving(true)
                }
              >
                {closed ? t('unarchive') : t('archive')}
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">{t('lead')}</p>
            <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('machine')}</dt>
              <dd className="flex items-center gap-2">
                <span
                  className={cn('size-2 rounded-full', offline ? 'bg-amber-500' : 'bg-green-600')}
                />
                {project.environment_name}
                <span className="text-muted-foreground">
                  {offline ? t('offline') : t('online')}
                </span>
              </dd>
              <dt className="text-muted-foreground">{t('workspace')}</dt>
              <dd className="font-mono text-[13px]">{project.workspace_root}</dd>
              <dt className="text-muted-foreground">{t('directory')}</dt>
              <dd className="font-mono text-[13px]">{project.directory}</dd>
            </dl>
            {closed ? <p className="text-sm text-amber-700">{t('archivedNote')}</p> : null}
            {act.rename.isError || act.archive.isError ? (
              <p role="alert" className="text-destructive text-sm">
                {t('problem')}
              </p>
            ) : null}
          </header>

          {closed ? null : (
            <section>
              <div className="flex flex-wrap gap-2">
                <Link href={start('chat')} className={cn(buttonVariants({ variant: 'outline' }))}>
                  {t('newChat')}
                </Link>
                <Link
                  href={start('work')}
                  aria-disabled={offline}
                  className={cn(buttonVariants({ variant: 'outline' }), offline && off)}
                >
                  {t('newWork')}
                </Link>
                <Link
                  href={routes.askExpert(locale, id)}
                  aria-disabled={offline || detail.data.active_task_id !== null}
                  className={cn(
                    buttonVariants({ variant: 'default' }),
                    (offline || detail.data.active_task_id !== null) && off,
                  )}
                >
                  {t('askExpert')}
                </Link>
              </div>
              {offline ? (
                <p className="text-muted-foreground mt-2 text-[13px]">{t('offlineNote')}</p>
              ) : null}
            </section>
          )}

          {conversations.length === 0 && tasks.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border px-4 py-6 text-center text-sm">
              {t('empty')}
            </p>
          ) : (
            <>
              <section aria-label={t('conversations')}>
                <h2 className={heading}>{t('conversations')}</h2>
                {conversations.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('noConversations')}</p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {conversations.map((each) => (
                      <li key={each.id}>
                        <Link
                          href={routes.projectConversation(locale, id, each.id)}
                          className="hover:bg-muted/60 flex items-center gap-3 px-4 py-2.5 text-sm"
                        >
                          {each.kind === 'chat' ? (
                            <MessageSquareIcon className="size-4 shrink-0" />
                          ) : (
                            <WrenchIcon className="size-4 shrink-0" />
                          )}
                          <span className="text-muted-foreground w-8 shrink-0 text-xs">
                            {t(`kind.${each.kind}`)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {each.title ?? t('untitled')}
                          </span>
                          {each.active_task_id ? (
                            <span className="shrink-0 text-[13px] text-amber-600">
                              {t('expertWorking')}
                            </span>
                          ) : null}
                          <span className="text-muted-foreground w-36 shrink-0 text-right text-[13px]">
                            {when(each.last_active_at)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-label={t('handbacks')}>
                <h2 className={heading}>{t('handbacks')}</h2>
                {tasks.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('noHandbacks')}</p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {tasks.map((task) => {
                      const row = (
                        <>
                          <span className="min-w-0 flex-1 truncate">{task.question}</span>
                          <span className="text-muted-foreground shrink-0">{task.expert}</span>
                          <span
                            className={cn(
                              'w-14 shrink-0',
                              task.state === 'SUCCEEDED'
                                ? 'text-green-700 dark:text-green-400'
                                : 'text-muted-foreground',
                            )}
                          >
                            {task.state_word ?? t('running')}
                          </span>
                          <span className="w-16 shrink-0 text-right tabular-nums">
                            {amount(task.spent, task.currency)}
                          </span>
                          <span className="text-muted-foreground w-36 shrink-0 text-right text-[13px]">
                            {when(task.ended_at ?? task.created_at)}
                          </span>
                        </>
                      )
                      const cell = 'flex items-center gap-3 px-4 py-2.5 text-sm'
                      return (
                        <li key={task.id}>
                          <Link
                            href={routes.projectConversation(locale, id, task.session_id)}
                            className={cn(cell, 'hover:bg-muted/60')}
                          >
                            {row}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      {/* 在项目页就能看这个项目的文件、开终端，不用先进某段对话（所有者 2026-10-18） */}
      <WorkSidePanel
        files={[]}
        directory={project.directory}
        live={false}
        environment={project.environment_id}
        only={['files', 'terminal']}
      />

      <Dialog open={archiving} onOpenChange={setArchiving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('archiveTitle')}</DialogTitle>
            <DialogDescription>{t('archiveBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiving(false)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={act.archive.isPending}
              onClick={() =>
                act.archive.mutate(
                  { project: id, archived: true },
                  { onSuccess: () => setArchiving(false) },
                )
              }
            >
              {t('archiveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
