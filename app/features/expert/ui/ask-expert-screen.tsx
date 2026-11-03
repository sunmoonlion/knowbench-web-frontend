'use client'

import { CheckIcon, FolderIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ExpertChoices } from '@/components/workbench/expert-choices'
import { CrossAppLink } from '@/components/common/cross-app-link'
import type { ChosenExpert } from '@/components/workbench/find-expert-panel'
import { ConnectComputerLink } from '@/components/workbench/connect-computer'
import { useWorkbench } from '@/lib/workbench/context'
import { useExpertFinder } from '@/lib/workbench/expert-finder'
import { WorkbenchError } from '@/lib/workbench/http'
import { useMachines, useProjectDetail, useSandboxes } from '@/lib/workbench/queries'
import { routes } from '@/lib/workbench/routes'
import { cn } from '@/lib/utils'

import { useAsk, useDataNeeds, usePacks, useSaid } from '../api/desk'
import { askBlocker, busyConversation, findBlocker, sees } from '../model/ask'
import { FindExpertPanel } from './find-expert-panel'

const QUESTION = 'workbench.question'
const label = 'text-muted-foreground mb-1.5 text-xs font-medium'
const noSubscription = () => () => {}

// 请专家。左边是用户填的，右边是专家的承诺：换一位专家，右边整个换掉。
// 不填预算上限：花了多少实时显示，随时能停（所有者 2026-10-04）。
export function AskExpertScreen({
  project: projectId,
  from,
  expert,
}: {
  project: string
  // 从哪段对话里来的。有的话，专家接着那段对话做
  from: string | null
  // 从专家首页点了哪一位
  expert: string | null
}) {
  const t = useTranslations('askExpert')
  const router = useRouter()
  const { locale } = useWorkbench()
  const packs = usePacks()
  const project = useProjectDetail(projectId)
  const sandboxes = useSandboxes()
  const machines = useMachines()
  const said = useSaid(from)
  const ask = useAsk()
  const startFind = useExpertFinder()
  // 「让 AI 找」那一轮的任务号：有了就在专家清单上方显示结果
  const findTask = useSearchParams().get('match')

  const [chosen, setChosen] = useState<string | null>(expert)
  const [selectedByAI, setSelectedByAI] = useState<ChosenExpert | null>(null)
  const [seenExpert, setSeenExpert] = useState(expert)
  if (expert !== seenExpert) {
    setSeenExpert(expert)
    if (expert) {
      setChosen(expert)
      setSelectedByAI(null)
    }
  }
  // 固定与动态专家都沿用数据授权、补采和本人确认。
  const needs = useDataNeeds(chosen)
  const checkingNeeds =
    Boolean(chosen?.startsWith('knowbot:')) && (needs.isPending || needs.isError)
  // 用户自己打的字。没打过的时候用带进来的那句
  const [typed, setTyped] = useState<string | null>(null)
  // 同一页交两次用同一个号：后端认得出是同一次
  const [key] = useState(() => crypto.randomUUID())
  // 带入问题：从首页来的是首页写的那句（记在浏览器里）；从对话里来的是那段对话里最近说的一句
  const fromHome = useSyncExternalStore(
    noSubscription,
    () => window.sessionStorage.getItem(QUESTION),
    () => null,
  )
  const question = typed ?? (from ? said.data?.last : fromHome) ?? ''

  const pack = (packs.data ?? []).find((each) => each.id === chosen)
  const dataNeeds = needs.data?.contract ? needs.data : null
  const blocker = askBlocker({
    pack,
    question,
    project: project.data,
    sandboxes: sandboxes.data?.length,
    machines: machines.isSuccess ? machines.data.length : undefined,
  })
  const findBlocked = findBlocker({
    question,
    project: project.data,
    sandboxes: sandboxes.data?.length,
    machines: machines.isSuccess ? machines.data.length : undefined,
  })
  const busyAt = busyConversation(project.data)
  const seen = sees(project.data, from)
  const back = from ? routes.projectConversation(locale, projectId, from) : routes.expert(locale)

  async function submit() {
    if (blocker !== null || !pack || ask.isPending) return
    if (checkingNeeds) return
    const matched =
      selectedByAI?.pack.id === chosen &&
      selectedByAI.question === question.trim() &&
      selectedByAI.project === projectId
    if (needs.data?.scope_check_required && !matched) {
      await find(pack.id)
      return
    }
    try {
      const made = await ask.mutateAsync({
        project: projectId,
        from,
        expert: pack.id,
        question: question.trim(),
        key: matched ? `find-expert:${selectedByAI!.task}` : key,
        match: matched ? selectedByAI!.match : undefined,
      })
      window.sessionStorage.removeItem(QUESTION)
      router.push(
        made.conversation
          ? routes.projectConversation(locale, projectId, made.conversation)
          : routes.expert(locale),
      )
    } catch {
      // 原因显示在下面
    }
  }

  // 让你的模型按专家自己写的范围替你找（请专家方案设计第 4.9 节）
  async function find(selected?: string) {
    if (startFind.isPending || ask.isPending) return
    if (findBlocked !== null) {
      document
        .getElementById(findBlocked === 'noQuestion' ? 'ask-question' : 'ask-find-reason')
        ?.focus()
      return
    }
    setChosen(null)
    setSelectedByAI(null)
    try {
      await startFind.find({
        project: projectId,
        question: question.trim(),
        from,
        expert: selected,
      })
    } catch {
      // 原因显示在按钮下面
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-8 lg:grid-cols-2">
          <div className="space-y-6">
            <h1 className="text-xl font-semibold tracking-tight">
              {pack ? t('titleWith', { name: pack.name }) : t('title')}
            </h1>

            <section>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className={cn(label, 'mb-0')}>{t('who')}</p>
                <CrossAppLink
                  to="knowmart.knowbots"
                  refValue="expert"
                  className="text-xs underline underline-offset-3"
                >
                  {t('summon')}
                </CrossAppLink>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={startFind.isPending || ask.isPending}
                  aria-describedby="ask-find-reason"
                  title={findBlocked ? t(`blocker.${findBlocked}`) : t('findHint')}
                  onClick={() => void find()}
                >
                  {startFind.isPending ? t('finding') : t('find')}
                </Button>
              </div>
              <p id="ask-find-reason" role="status" tabIndex={-1} className="mb-2 text-sm">
                {findBlocked ? t(`blocker.${findBlocked}`) : null}
                {findBlocked === 'noMachine' || findBlocked === 'offline' ? (
                  <ConnectComputerLink className="ml-2" />
                ) : null}
                {findBlocked === 'noSandbox' ? (
                  <Link href={routes.settings(locale)} className="ml-2 underline">
                    {t('toSettings')}
                  </Link>
                ) : null}
                {findBlocked === 'busy' && busyAt ? (
                  <Link
                    href={routes.projectConversation(locale, projectId, busyAt)}
                    className="ml-2 underline"
                  >
                    {t('toBusy')}
                  </Link>
                ) : null}
              </p>
              <p className="text-muted-foreground mb-2 text-sm">{t('findHint')}</p>
              {startFind.isError ? (
                <p role="alert" className="text-destructive mb-2 text-[13px]">
                  {t('findFailed')}
                </p>
              ) : null}
              {findTask ? (
                <div className="mb-3">
                  <FindExpertPanel
                    task={findTask}
                    project={projectId}
                    onSelect={(selection) => {
                      setChosen(selection.pack.id)
                      setSelectedByAI(selection)
                    }}
                    expectedQuestion={typed === null ? undefined : typed}
                    onEdit={(original) => {
                      setTyped(original)
                      router.push(routes.askExpert(locale, projectId, from ?? undefined))
                      document.getElementById('ask-question')?.focus()
                    }}
                  />
                </div>
              ) : null}
              <ExpertChoices
                packs={packs.data ?? []}
                selected={chosen}
                onSelect={(id) => {
                  setChosen(id)
                  setSelectedByAI(null)
                  if (findTask)
                    router.replace(routes.askExpert(locale, projectId, from ?? undefined))
                }}
                onRemoved={(id) => {
                  if (chosen === id) {
                    setChosen(null)
                    setSelectedByAI(null)
                    if (findTask || expert === id)
                      router.replace(routes.askExpert(locale, projectId, from ?? undefined))
                  }
                }}
              />
              {packs.isPending ? (
                <p className="text-muted-foreground text-sm">{t('loading')}</p>
              ) : packs.isError ? (
                <p role="alert" className="text-destructive text-sm">
                  {t('packsFailed')}
                </p>
              ) : null}
            </section>

            <section>
              <label htmlFor="ask-question" className={cn(label, 'block')}>
                {t('question')}
              </label>
              <Textarea
                id="ask-question"
                rows={4}
                value={question}
                onChange={(event) => setTyped(event.target.value)}
                className="min-h-24"
              />
              {pack ? (
                <p className="text-muted-foreground mt-1.5 text-[13px]">
                  {t('questionHint', { input: pack.input })}
                </p>
              ) : null}
              {from ? (
                <p className="text-muted-foreground mt-1 text-[13px]">{t('continues')}</p>
              ) : null}
            </section>

            {dataNeeds && pack ? (
              // 清单 v2（decisions ⑭）：不用选数据；开跑后先按问题列出要哪些，你确认后才取、才做
              <section aria-label={t('byQuestion.title')} data-testid="ask-by-question">
                <p className={label}>{t('byQuestion.title')}</p>
                <p className="text-muted-foreground text-[13px]">{t('byQuestion.lead')}</p>
                {dataNeeds.bound ? (
                  <p className="text-muted-foreground mt-1 text-[13px]">
                    {t('byQuestion.bound', { count: dataNeeds.bound })}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section>
              <p className={label}>{t('project')}</p>
              <p className="flex items-center gap-2 text-sm">
                <FolderIcon className="size-4 shrink-0" />
                {project.data?.project.title ?? t('loading')}
                <span className="text-muted-foreground truncate font-mono text-xs">
                  {project.data?.project.directory}
                </span>
              </p>
            </section>

            <section>
              <p className={label}>{t('cost')}</p>
              <p className="text-sm">{t('costLine1')}</p>
              <p className="text-sm">{t('costLine2')}</p>
            </section>

            <section>
              <p className={label}>{t('sees')}</p>
              <ul className="space-y-1 text-sm">
                {from ? (
                  <li className="flex items-center gap-2">
                    <CheckIcon className="size-3.5 shrink-0" />
                    {t('seesThis', { turns: said.data?.turns ?? 0 })}
                  </li>
                ) : null}
                <li className="flex items-center gap-2">
                  <CheckIcon className="size-3.5 shrink-0" />
                  {t('seesFiles')}
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="size-3.5 shrink-0" />
                  {t('seesOthers', seen)}
                </li>
              </ul>
            </section>
          </div>

          <aside className="bg-muted/30 h-fit space-y-5 rounded-xl border p-5">
            {pack ? (
              <>
                <section>
                  <h2 className={label}>{t('will')}</h2>
                  {needs.data?.contract === 'knowbot-manifest/v3' ? (
                    <p className="text-muted-foreground text-sm">{t('dynamicPlan')}</p>
                  ) : null}
                  <ol className="space-y-2.5">
                    {pack.steps.map((step) => (
                      <li key={step.index} className="text-sm">
                        <p className="font-medium">
                          {step.index} {step.title}
                        </p>
                        <p className="text-[13px]">{step.summary}</p>
                        <p className="text-muted-foreground text-[13px]">
                          → {step.after_rejection.text}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
                <section className="border-t pt-4">
                  <h2 className={label}>{t('wont')}</h2>
                  <p className="text-sm">{pack.does_not_solve}</p>
                </section>
                <section className="border-t pt-4">
                  <h2 className={label}>{t('returns')}</h2>
                  <p className="text-sm">{pack.output}</p>
                </section>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">{t('choose')}</p>
            )}
          </aside>
        </div>
      </div>

      <footer className="shrink-0 border-t px-6 py-3">
        <div className="mx-auto flex w-full max-w-5xl items-end gap-6">
          <ul className="text-muted-foreground min-w-0 flex-1 space-y-0.5 text-[13px]">
            <li className="truncate">{t('confirm1', { question: question.trim() || '…' })}</li>
            <li>{t('confirm2')}</li>
            <li>{t('confirm3')}</li>
          </ul>
          <div className="shrink-0 text-right">
            {chosen?.startsWith('knowbot:') && needs.isError ? (
              <p role="alert" className="text-destructive mb-1.5 text-[13px]">
                {t('scopeLoadFailed')}{' '}
                <button type="button" className="underline" onClick={() => void needs.refetch()}>
                  {t('scopeRetry')}
                </button>
              </p>
            ) : null}
            {ask.isError ? (
              <p role="alert" className="text-destructive mb-1.5 text-[13px]">
                {t.has(`problem.${(ask.error as WorkbenchError).code}`)
                  ? t(`problem.${(ask.error as WorkbenchError).code}`)
                  : t('problem.other')}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Link href={back} className={cn(buttonVariants({ variant: 'outline' }))}>
                {t('cancel')}
              </Link>
              <Button
                disabled={blocker !== null || ask.isPending || startFind.isPending || checkingNeeds}
                title={blocker ? t(`blocker.${blocker}`) : undefined}
                onClick={() => void submit()}
              >
                {ask.isPending || startFind.isPending
                  ? t('submitting')
                  : needs.data?.scope_check_required && !selectedByAI?.match
                    ? t('checkScope')
                    : t('submit')}
              </Button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
