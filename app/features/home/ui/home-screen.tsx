'use client'

import { ArrowUpIcon, FolderIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { CrossAppLink } from '@/components/common/cross-app-link'
import { ExpertChoices } from '@/components/workbench/expert-choices'
import { FindExpertPanel, type ChosenExpert } from '@/components/workbench/find-expert-panel'
import { KnowbotArrival } from '@/components/workbench/knowbot-arrival'
import { ProjectPicker } from '@/components/workbench/project-picker'
import { ConnectComputerLink } from '@/components/workbench/connect-computer'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useWorkbench } from '@/lib/workbench/context'
import { WorkbenchError } from '@/lib/workbench/http'
import {
  useConversations,
  useMachines,
  usePending,
  useProjects,
  useSandboxes,
} from '@/lib/workbench/queries'
import { conversationRoute, isBuilt, MODES, routes, type Mode } from '@/lib/workbench/routes'
import { cn } from '@/lib/utils'

import { useAsk, usePacks, useDataNeeds } from '@/lib/workbench/expert-desk'
import { useExpertFinder } from '@/lib/workbench/expert-finder'

import { useOpenTaskFromRef } from '../api/open-task'
import { useStart } from '../api/start'
import { blockerOf, projectIsRequired } from '../model/start'

export function HomeScreen() {
  const t = useTranslations('home')
  const askText = useTranslations('askExpert')
  const connect = useTranslations('computerConnection')
  const router = useRouter()
  const { locale } = useWorkbench()
  const query = useSearchParams()
  const asked = query.get('mode')
  const mode: Mode = asked === 'work' || asked === 'expert' ? asked : 'chat'
  // 从项目页点「新聊天」「新工作」进来：项目已经选好
  const given = query.get('project')
  // 从别的应用回来带着委托编号（knowbase 直达上传传完回到这里）：打开那件委托
  useOpenTaskFromRef(query.get('ref'))

  const projects = useProjects()
  const machines = useMachines(5000)
  const sandboxes = useSandboxes()
  const pending = usePending()
  const conversations = useConversations()
  const start = useStart()

  const [text, setText] = useState('')
  const [chosen, setProjectId] = useState<string | null | undefined>(undefined)
  // 聊天什么都不选（0017）：带进来的项目只对工作、专家有效
  const projectId = mode === 'chat' ? null : chosen === undefined ? given : chosen
  const [picking, setPicking] = useState(false)
  // 专家：在对话框里直接挑一位（专家市场上线前先用内置的清单，0017 §三）
  const packs = usePacks()
  // 从 knowmart 请来分身后会带 expert=<这一位> 回到这里，先选好它
  const incomingExpert = query.get('expert')
  const [expert, setExpert] = useState<string | null>(incomingExpert)
  const [askKey] = useState(() => crypto.randomUUID())
  const ask = useAsk()
  const finder = useExpertFinder()
  const [findTask, setFindTask] = useState<string | null>(null)
  const [selectedByAI, setSelectedByAI] = useState<ChosenExpert | null>(null)
  const [seenExpert, setSeenExpert] = useState(incomingExpert)
  // pin 后 router.replace 只更新查询参数，首页不会重新挂载。收到新的专家时同步
  // 选择状态；同一参数下保留用户后续切换，也保留已经输入的问题和项目。
  if (incomingExpert !== seenExpert) {
    setSeenExpert(incomingExpert)
    if (incomingExpert) {
      setExpert(incomingExpert)
      setSelectedByAI(null)
      setFindTask(null)
    }
  }
  const selectedPack = (packs.data ?? []).find((pack) => pack.id === expert)
  const needs = useDataNeeds(expert)
  const checkingNeeds =
    Boolean(expert?.startsWith('knowbot:')) && (needs.isPending || needs.isError)

  const project = (projects.data ?? []).find((each) => each.id === projectId)
  const blocker = blockerOf({
    mode,
    text,
    project,
    sandboxes: sandboxes.data?.length,
    machines: machines.isSuccess ? machines.data : undefined,
  })
  const held = start.isError && (start.error as WorkbenchError).code === 'project_held_by_expert'
  const expertConversation = (conversations.data ?? []).find(
    (each) => each.project_id === projectId && each.active_task_id !== null,
  )

  async function send() {
    if (blocker !== null || start.isPending || ask.isPending || finder.isPending) return
    if (mode === 'expert') {
      // 专家：服务端先编排再进入对话。在这里直接请，不再跳到另一页（0017）
      if (!projectId) return
      const matched =
        selectedByAI?.pack.id === expert &&
        selectedByAI.question === text.trim() &&
        selectedByAI.project === projectId
      if (needs.data?.scope_check_required && !matched) {
        await find(expert ?? undefined)
        return
      }
      if (!expert || !selectedPack || checkingNeeds) return
      try {
        const made = await ask.mutateAsync({
          project: projectId,
          from: null,
          expert,
          question: text.trim(),
          key: matched ? `find-expert:${selectedByAI!.task}` : askKey,
          match: matched ? selectedByAI!.match : undefined,
        })
        if (made.conversation) {
          router.push(routes.projectConversation(locale, projectId, made.conversation))
        }
      } catch {
        // 原因显示在输入框下面
      }
      return
    }
    try {
      const made = await start.mutateAsync({ kind: mode, project: projectId, text: text.trim() })
      router.push(conversationRoute(locale, made))
    } catch {
      // 原因显示在输入框下面
    }
  }

  async function find(selected?: string) {
    if (finder.isPending || ask.isPending) return
    if (blocker !== null || !projectId) {
      if (blocker === 'empty') document.getElementById('home-question')?.focus()
      else if (blocker === 'needProject') setPicking(true)
      else document.getElementById('home-find-reason')?.focus()
      return
    }
    setSelectedByAI(null)
    setFindTask(null)
    setExpert(null)
    try {
      const task = await finder.find({
        project: projectId,
        question: text,
        from: null,
        expert: selected,
        navigate: false,
      })
      if (task) setFindTask(task)
    } catch {
      /* shown below */
    }
  }

  // 「还没写字」不用说出来：发送钮是灰的就够了
  const said = blocker && blocker !== 'empty' ? blocker : null
  const welcome = asked === null && !given && machines.isSuccess && machines.data.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-[12vh] pb-16">
        {/* 通用首页欢迎卡；明确选择聊天或从项目进入聊天时不提示接电脑。 */}
        {welcome ? (
          <section className="space-y-3 rounded-xl border p-5" aria-label={connect('welcome')}>
            <p>{connect('welcome')}</p>
            <Link href={routes.settings(locale)} className="mr-3 underline underline-offset-3">
              {t('toSettings')}
            </Link>
            <ConnectComputerLink />
          </section>
        ) : null}
        <KnowbotArrival />
        <h1 className="text-center text-2xl font-semibold tracking-tight">{t('title')}</h1>

        <section aria-label={t('title')}>
          <nav aria-label={t('modes')} className="mb-3 flex justify-center gap-2">
            {MODES.map((each) => (
              <Link
                key={each}
                href={routes.home(locale, each)}
                aria-current={mode === each ? 'true' : undefined}
                className={cn(
                  'rounded-full border px-4 py-1 text-sm',
                  mode === each
                    ? 'bg-foreground text-background border-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`mode.${each}.name`)}
              </Link>
            ))}
          </nav>
          <p className="text-muted-foreground mb-3 text-center text-[13px]">
            {t(`mode.${mode}.what`)}
          </p>

          <div className="bg-background focus-within:border-ring rounded-2xl border p-2 shadow-xs">
            <Textarea
              id="home-question"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void send()
                }
              }}
              rows={3}
              aria-label={t(`mode.${mode}.placeholder`)}
              placeholder={t(`mode.${mode}.placeholder`)}
              className="max-h-64 min-h-20 resize-none border-0 bg-transparent px-2 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {mode === 'expert' ? (
              <div className="px-1 pt-1" aria-label={t('expert.who')}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-muted-foreground text-xs">{t('expert.who')}</p>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <CrossAppLink
                    to="knowmart.knowbots"
                    refValue="expert"
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    {t('expert.summon')}
                  </CrossAppLink>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={finder.isPending || ask.isPending}
                    aria-describedby="home-find-reason"
                    title={
                      blocker
                        ? blocker === 'empty'
                          ? askText('blocker.noQuestion')
                          : t(`blocker.${blocker}`)
                        : undefined
                    }
                    onClick={() => void find()}
                  >
                    {finder.isPending ? askText('finding') : t('expert.find')}
                  </Button>
                  <CrossAppLink
                    to="knowlab.createIdea"
                    refValue="expert"
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    {askText('createIdea')}
                  </CrossAppLink>
                </div>
                <p id="home-find-reason" role="status" tabIndex={-1} className="mb-2 text-sm">
                  {blocker
                    ? blocker === 'empty'
                      ? askText('blocker.noQuestion')
                      : t(`blocker.${blocker}`)
                    : null}
                  {blocker === 'noMachine' || blocker === 'machineOffline' ? (
                    <ConnectComputerLink className="ml-2" />
                  ) : null}
                  {blocker === 'noSandbox' ? (
                    <Link href={routes.settings(locale)} className="ml-2 underline">
                      {t('toSettings')}
                    </Link>
                  ) : null}
                </p>
                <p className="text-muted-foreground mb-2 text-sm">{t('expert.findHint')}</p>
                {findTask && projectId ? (
                  <FindExpertPanel
                    task={findTask}
                    project={projectId}
                    expectedQuestion={text}
                    onSelect={(chosen) => {
                      setExpert(chosen.pack.id)
                      setSelectedByAI(chosen)
                    }}
                  />
                ) : null}
                <ExpertChoices
                  packs={packs.data ?? []}
                  selected={expert}
                  onSelect={(id) => {
                    setExpert(id)
                    setSelectedByAI(null)
                    setFindTask(null)
                  }}
                  onRemoved={(id) => {
                    if (expert === id) {
                      setExpert(null)
                      setSelectedByAI(null)
                      setFindTask(null)
                    }
                    if (incomingExpert === id) {
                      const params = new URLSearchParams(query.toString())
                      params.delete('expert')
                      router.replace(`${routes.home(locale)}?${params}`)
                    }
                  }}
                />
                {packs.isPending ? (
                  <span className="text-muted-foreground text-xs">{t('expert.loading')}</span>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center gap-2 px-1 pt-1">
              {/* 在哪个项目里：工作与专家在输入框的角上选；聊天什么都不选（0017） */}
              {projectIsRequired(mode) ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
                    <FolderIcon />
                    {project ? project.title : t('project.choose')}
                  </Button>
                  <Link
                    href={routes.projects(locale)}
                    className="text-muted-foreground hover:text-foreground text-[13px] underline-offset-3 hover:underline"
                  >
                    {t('project.create')}
                  </Link>
                </>
              ) : null}
              <div className="flex-1" />
              <Button
                size="icon"
                onClick={() => void send()}
                disabled={
                  blocker !== null ||
                  start.isPending ||
                  ask.isPending ||
                  finder.isPending ||
                  (mode === 'expert' && (!selectedPack || checkingNeeds))
                }
                aria-label={t(`mode.${mode}.send`)}
                title={t(`mode.${mode}.send`)}
              >
                <ArrowUpIcon />
              </Button>
            </div>
          </div>
          {mode === 'expert' && expert?.startsWith('knowbot:') && needs.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {askText('scopeLoadFailed')}{' '}
              <button type="button" className="underline" onClick={() => void needs.refetch()}>
                {askText('scopeRetry')}
              </button>
            </p>
          ) : null}
          {finder.isError ? (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {t('expert.findFailed')}
            </p>
          ) : null}

          {mode !== 'expert' && said && !(welcome && said === 'noSandbox') ? (
            <p className="text-muted-foreground mt-2 text-center text-[13px]">
              {t(`blocker.${said}`)}
              {said === 'noMachine' ? <ConnectComputerLink className="ml-2" /> : null}
              {said === 'noSandbox' && isBuilt('settings') ? (
                <>
                  {' '}
                  <Link href={routes.settings(locale)} className="underline underline-offset-3">
                    {t('toSettings')}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {start.isError || ask.isError ? (
            <p role="alert" className="text-destructive mt-2 text-center text-[13px]">
              {t.has(`problem.${((start.error ?? ask.error) as WorkbenchError).code}`)
                ? t(`problem.${((start.error ?? ask.error) as WorkbenchError).code}`)
                : t('problem.other')}
              {held && projectId ? (
                <>
                  {' '}
                  <Link
                    href={
                      expertConversation
                        ? conversationRoute(locale, expertConversation)
                        : routes.project(locale, projectId)
                    }
                    className="underline underline-offset-3"
                  >
                    {t('problem.openExpert')}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </section>

        {pending.data && pending.data.length > 0 ? (
          <section aria-label={t('pending.title')}>
            <h2 className="mb-2 text-sm font-medium">
              {t('pending.title')}
              <span className="bg-foreground text-background ml-2 rounded-full px-1.5 text-xs">
                {pending.data.length}
              </span>
            </h2>
            <ul className="divide-y rounded-xl border border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
              {pending.data.map((each) => {
                const inner = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {each.where.about ?? each.kind}
                      </span>
                      <span className="text-muted-foreground block truncate text-[13px]">
                        {[each.where.project?.title, each.where.conversation?.title, each.why]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-medium">{t('pending.open')}</span>
                  </>
                )
                // 答题只在事发处：点行回到那段对话，审查面就在它发生的位置
                const where = each.where.conversation
                const href = where
                  ? conversationRoute(locale, {
                      id: where.id,
                      project_id: each.where.project?.id ?? null,
                      kind: where.kind,
                    })
                  : null
                return (
                  <li key={each.interaction_id}>
                    {href ? (
                      <Link
                        href={href}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-100/60"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-2.5">{inner}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}
      </div>

      <ProjectPicker
        open={picking}
        onOpenChange={setPicking}
        title={t('project.pickTitle')}
        description={t(`project.pick.${mode}`)}
        onPick={(picked) => {
          setProjectId(picked)
          setPicking(false)
        }}
      />
    </div>
  )
}
