'use client'

import { CheckIcon, FolderIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ConnectComputerLink } from '@/components/workbench/connect-computer'
import { useWorkbench } from '@/lib/workbench/context'
import { WorkbenchError } from '@/lib/workbench/http'
import { useMachines, useProjectDetail, useSandboxes } from '@/lib/workbench/queries'
import { routes } from '@/lib/workbench/routes'
import { cn } from '@/lib/utils'

import { useAsk, useDataNeeds, usePacks, useSaid } from '../api/desk'
import { askBlocker, busyConversation, sees } from '../model/ask'
import { choicesOf, pickProblems, type Picks, picksFromLast } from '../model/data'
import { DataDialog, NeedLine } from './data-dialog'

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

  const [chosen, setChosen] = useState<string | null>(expert)
  // 专家写了数据需求声明（SDD 0042）：按声明选的数据，每位专家各记各的；没动过就用上次选的
  const needs = useDataNeeds(chosen, projectId)
  const [picksBy, setPicksBy] = useState<Record<string, Picks>>({})
  const [choosingData, setChoosingData] = useState(false)
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
  const declared = needs.data?.needs ?? []
  const picks =
    (chosen ? picksBy[chosen] : undefined) ?? picksFromLast(declared, needs.data?.last ?? [])
  const missing = pickProblems(declared, picks)
  const blocker = askBlocker({
    pack,
    question,
    project: project.data,
    sandboxes: sandboxes.data?.length,
    machines: machines.isSuccess ? machines.data.length : undefined,
    dataProblems: missing.length,
  })
  const busyAt = busyConversation(project.data)
  const seen = sees(project.data, from)
  const back = from ? routes.projectConversation(locale, projectId, from) : routes.expert(locale)

  async function submit() {
    if (blocker !== null || !pack || ask.isPending) return
    try {
      const made = await ask.mutateAsync({
        project: projectId,
        from,
        expert: pack.id,
        question: question.trim(),
        key,
        data: choicesOf(declared, picks),
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-8 lg:grid-cols-2">
          <div className="space-y-6">
            <h1 className="text-xl font-semibold tracking-tight">
              {pack ? t('titleWith', { name: pack.name }) : t('title')}
            </h1>

            <section>
              <p className={label}>{t('who')}</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {(packs.data ?? []).map((each) => {
                  // 筹备中的专家：看得见、读得到它要做什么，请不了
                  const preparing = each.status === 'preparing'
                  return (
                    <li key={each.id}>
                      <button
                        type="button"
                        aria-pressed={chosen === each.id}
                        aria-disabled={preparing || undefined}
                        onClick={() => {
                          if (!preparing) setChosen(each.id)
                        }}
                        className={cn(
                          'hover:bg-muted/60 w-full rounded-lg border p-3 text-left',
                          chosen === each.id && 'border-foreground bg-muted/60',
                          preparing && 'cursor-default opacity-70 hover:bg-transparent',
                        )}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {each.name}
                          {preparing ? (
                            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-normal">
                              {t('preparing')}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground block text-[13px]">
                          {each.tagline}
                        </span>
                        {preparing && each.preparing_note ? (
                          <span className="text-muted-foreground mt-1 block text-xs">
                            {each.preparing_note}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
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

            {declared.length ? (
              <section aria-label={t('data.title')}>
                <p className={label}>{t('data.title')}</p>
                <p className="text-muted-foreground mb-2 text-[13px]">{t('data.lead')}</p>
                <ul className="space-y-1.5">
                  {declared.map((need) => {
                    const names = (picks[need.key] ?? []).map((each) => each.name)
                    const short = missing.some((problem) => problem.need.key === need.key)
                    return (
                      <li key={need.key} className="text-sm">
                        <span className="font-medium">{need.name}</span> <NeedLine need={need} />
                        <p
                          className={cn(
                            'truncate text-[13px]',
                            short ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                          )}
                        >
                          {names.length ? names.join(' · ') : t('data.none')}
                        </p>
                      </li>
                    )
                  })}
                </ul>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => setChoosingData(true)}
                >
                  {t(
                    Object.values(picks).some((each) => each.length)
                      ? 'data.change'
                      : 'data.choose',
                  )}
                </Button>
                <DataDialog
                  open={choosingData}
                  onOpenChange={setChoosingData}
                  needs={declared}
                  picks={picks}
                  onChange={(next) => chosen && setPicksBy({ ...picksBy, [chosen]: next })}
                  environment={project.data?.project.environment_id ?? null}
                />
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
            {blocker && blocker !== 'noExpert' && blocker !== 'noQuestion' ? (
              <p className="mb-1.5 text-[13px] text-amber-700 dark:text-amber-400">
                {t(`blocker.${blocker}`)} {blocker === 'noMachine' ? <ConnectComputerLink /> : null}
                {blocker === 'busy' && busyAt ? (
                  <Link
                    href={routes.projectConversation(locale, projectId, busyAt)}
                    className="underline underline-offset-3"
                  >
                    {t('toBusy')}
                  </Link>
                ) : null}
                {blocker === 'noSandbox' ? (
                  <Link href={routes.settings(locale)} className="underline underline-offset-3">
                    {t('toSettings')}
                  </Link>
                ) : null}
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
                disabled={blocker !== null || ask.isPending}
                title={blocker ? t(`blocker.${blocker}`) : undefined}
                onClick={() => void submit()}
              >
                {ask.isPending ? t('submitting') : t('submit')}
              </Button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
