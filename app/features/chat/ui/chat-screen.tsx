'use client'

import { FolderIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { CloudDataButton } from '@/components/workbench/cloud-data-button'
import { Composer } from '@/components/workbench/composer'
import { ConversationTitle } from '@/components/workbench/conversation-title'
import { ProjectPicker } from '@/components/workbench/project-picker'
import { WorkSidePanel } from '@/components/workbench/side-panel'
import { Button } from '@/components/ui/button'
import { Marker, MarkerContent } from '@/components/ui/marker'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useConversationEvents } from '@/lib/workbench/conversation-events'
import { useWorkbench } from '@/lib/workbench/context'
import { WorkbenchError } from '@/lib/workbench/http'
import { useProjects } from '@/lib/workbench/queries'
import { isBuilt, routes } from '@/lib/workbench/routes'

import { useConversation, useConversationActions } from '@/lib/workbench/conversation'
import { running, thread } from '../model/thread'
import { Turn } from './turn'

type Asking = 'project' | 'work' | 'expert' | null

// 聊天页：一问一答。气泡对话；过程收成一行；模型在答的时候可以随时停。
// `cost` 是页面放进输入框下面的东西（花费那行小字）：聊天这个功能不认识别的功能。
export function ChatScreen({
  conversation: id,
  cost,
}: {
  conversation: string
  cost?: React.ReactNode
}) {
  const t = useTranslations('chat')
  const tc = useTranslations('conversation')
  const router = useRouter()
  const { locale } = useWorkbench()
  const { events, state } = useConversationEvents()
  const conversation = useConversation(id)
  const projects = useProjects()
  const act = useConversationActions(id)
  const [asking, setAsking] = useState<Asking>(null)

  const turns = thread(events)
  const live = running(turns)
  const session = conversation.data
  const project = session?.project_id
    ? (projects.data ?? []).find((each) => each.id === session.project_id)
    : undefined
  const failed = [act.say, act.stop, act.rename, act.putInProject, act.turnIntoWork].find(
    (each) => each.isError,
  )?.error
  const problem = failed
    ? tc.has(`problem.${(failed as WorkbenchError).code}`)
      ? tc(`problem.${(failed as WorkbenchError).code}`)
      : tc('problem.other')
    : null

  async function intoWork(projectId: string | null) {
    if (projectId) await act.putInProject.mutateAsync(projectId)
    await act.turnIntoWork.mutateAsync()
    const target = projectId ?? session?.project_id
    if (target && isBuilt('projectConversation')) {
      router.push(routes.projectConversation(locale, target, id))
    }
  }

  async function picked(projectId: string) {
    const why = asking
    setAsking(null)
    try {
      if (why === 'project') await act.putInProject.mutateAsync(projectId)
      else if (why === 'work') await intoWork(projectId)
      else if (why === 'expert') {
        await act.putInProject.mutateAsync(projectId)
        router.push(routes.askExpert(locale, projectId, id))
      }
    } catch {
      // 原因显示在输入框上面
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <ConversationTitle title={session?.title} onRename={(title) => act.rename.mutate(title)} />
        {session ? (
          project ? (
            <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[13px]">
              <FolderIcon className="size-3.5" />
              {project.title}
            </span>
          ) : session.project_id === null ? (
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-muted-foreground text-[13px]">{t('noProject')}</span>
              <Button variant="outline" size="xs" onClick={() => setAsking('project')}>
                {t('putInProject')}
              </Button>
            </span>
          ) : null
        ) : null}
        <div className="flex-1" />
        {state === 'offline' ? (
          <span className="text-[13px] text-amber-600">{tc('stream.offline')}</span>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
                  {turns.length === 0 ? (
                    <Marker className="justify-center">
                      <MarkerContent>
                        {state === 'connecting' ? tc('stream.connecting') : t('empty')}
                      </MarkerContent>
                    </Marker>
                  ) : null}
                  {turns.map((turn, index) => (
                    // 正在答的那一轮顶到上面，回答往下长；都答完了就停在最后
                    <MessageScrollerItem
                      key={turn.key}
                      scrollAnchor={live !== null && index === turns.length - 1}
                    >
                      <Turn turn={turn} />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton aria-label={t('toEnd')} />
            </MessageScroller>
          </MessageScrollerProvider>

          <Composer
            busy={live !== null}
            sending={act.say.isPending}
            stopping={act.stop.isPending}
            problem={problem}
            onSend={(text) => act.say.mutateAsync(text)}
            onStop={() => act.stop.mutate()}
            placeholder={t('placeholder')}
            footer={cost}
          >
            <CloudDataButton session={session ? id : null} disabled={live !== null} />
            <Button
              variant="outline"
              size="sm"
              disabled={live !== null || !session}
              onClick={() =>
                session?.project_id ? void intoWork(null).catch(() => {}) : setAsking('work')
              }
            >
              {t('intoWork')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={live !== null || !session}
              onClick={() =>
                session?.project_id
                  ? router.push(routes.askExpert(locale, session.project_id, id))
                  : setAsking('expert')
              }
            >
              {tc('askExpert')}
            </Button>
          </Composer>
        </div>
        {session?.project_id ? (
          // 挂在项目下的聊天：可以只读看项目文件（0017），不改文件，所以没有「改动」
          <WorkSidePanel
            files={[]}
            directory={project?.directory ?? null}
            live={false}
            environment={session.environment_id ?? project?.environment_id ?? null}
            only={['files']}
          />
        ) : null}
      </div>

      <ProjectPicker
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={t(`pick.${asking ?? 'project'}.title`)}
        description={t(`pick.${asking ?? 'project'}.description`)}
        onPick={(projectId) => void picked(projectId)}
      />
    </div>
  )
}
