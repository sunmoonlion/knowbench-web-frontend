'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { ExpertPick, FindResult } from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import {
  rememberSummoned,
  useAskIncubation,
  useDirectAnswer,
  useFindResult,
  usePublishDemand,
} from '@/lib/workbench/find-expert'
import { usePinKnowbot } from '@/lib/workbench/knowbots'
import { routes } from '@/lib/workbench/routes'
import { cn } from '@/lib/utils'

import { useAsk } from '../api/desk'

// 「让 AI 找」的结果（请专家方案设计第 4.9 节）：你的模型按专家自己写的范围找，平台不排序。
// 不用另付钱的直接请（专家处理中那一页写明是 AI 替你请的、理由，可以换）；要付钱的你点了才请；
// 都不合适：两件事都不自动做，你点哪件做哪件、可以都点，推荐的那件标出来、写一句理由。
export function FindExpertPanel({
  task,
  project,
  from,
}: {
  task: string
  project: string
  // 从哪段对话里来的：请到的专家接着那段对话做
  from: string | null
}) {
  const t = useTranslations('findExpert')
  const found = useFindResult(task)
  const data = found.data
  if (found.isError)
    return (
      <p role="alert" className="text-destructive text-sm">
        {t('failed')}
      </p>
    )
  if (!data || !data.outcome) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {data?.error ? t('ended') : t('running')}
      </p>
    )
  }
  if (data.outcome === 'none') return <NoneCard result={data} task={task} project={project} />
  return <Picks key={data.task_id} result={data} project={project} from={from} />
}

function Picks({
  result,
  project,
  from,
}: {
  result: FindResult
  project: string
  from: string | null
}) {
  const t = useTranslations('findExpert')
  const router = useRouter()
  const { locale } = useWorkbench()
  const pin = usePinKnowbot()
  const ask = useAsk()
  const started = useRef(false)
  const inFlight = useRef(false)
  const [failed, setFailed] = useState(false)
  const picks = result.picks ?? []

  async function summon(pick: ExpertPick) {
    if (inFlight.current) return
    inFlight.current = true
    setFailed(false)
    try {
      // 钉住、建委托都用你自己的登录会话：作者数据的授权由你本人签（decisions 10-29）
      const pack = await pin.mutateAsync(`${pick.knowbot_id}@${pick.version}`)
      const made = await ask.mutateAsync({
        project,
        from,
        expert: pack.id,
        question: result.question,
        // 委托键归这轮找专家，不归组件挂载；刷新/丢响应重试仍取回原委托。
        // 后端幂等作用域另含用户与专家版本，不会串到另一位用户或候选。
        key: `find-expert:${result.task_id}`,
      })
      if (made.conversation) {
        rememberSummoned(made.conversation, { name: pick.name, reason: pick.reason })
        router.push(routes.projectConversation(locale, project, made.conversation))
      }
    } catch {
      setFailed(true)
    } finally {
      inFlight.current = false
    }
  }

  // 有合适的、不用另付钱：直接请，不用你点
  const auto = result.outcome === 'summon' ? picks[0] : undefined
  useEffect(() => {
    if (!auto || started.current) return
    started.current = true
    void summon(auto)
    // 只请一次；summon 每次渲染都是新的，不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  return (
    <section className="space-y-2" aria-label={t('picksTitle')}>
      {result.outcome === 'summon' && picks[0] ? (
        failed ? null : (
          <p className="text-sm" role="status">
            {t('summoning', { name: picks[0].name })}
          </p>
        )
      ) : (
        <>
          <p className="text-sm font-medium">{t('picksTitle')}</p>
          <p className="text-muted-foreground text-[13px]">{t('picksLead')}</p>
          <ul className="space-y-2">
            {picks.map((pick) => (
              <li key={`${pick.knowbot_id}@${pick.version}`} className="rounded-lg border p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {pick.name}
                  <span className="text-muted-foreground text-xs">
                    {pick.free ? t('free') : t('price', { price: pick.price ?? '—' })}
                  </span>
                </p>
                <p className="text-muted-foreground text-[13px]">{pick.tagline}</p>
                <p className="text-[13px]">{t('why', { reason: pick.reason })}</p>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={pin.isPending || ask.isPending}
                  onClick={() => void summon(pick)}
                >
                  {t('askThis')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {failed ? (
        <div className="space-y-2">
          <p role="alert" className="text-destructive text-sm">
            {t('summonFailed')}
          </p>
          {auto ? (
            <Button
              size="sm"
              disabled={pin.isPending || ask.isPending}
              onClick={() => void summon(auto)}
            >
              {t('retrySummon')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function NoneCard({
  result,
  task,
  project,
}: {
  result: FindResult
  task: string
  project: string
}) {
  const t = useTranslations('findExpert')
  const router = useRouter()
  const { locale } = useWorkbench()
  const direct = useDirectAnswer()
  const incubate = useAskIncubation(task)
  const publish = usePublishDemand(task)
  const [title, setTitle] = useState(result.demand?.title ?? '')
  const [problem, setProblem] = useState(result.demand?.problem ?? result.question)
  const recommended = result.recommend?.action

  async function answerDirectly() {
    const conversation = await direct.mutateAsync({ project, question: result.question, task })
    router.push(routes.projectConversation(locale, project, conversation))
  }

  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label={t('noneTitle')}>
      <p className="text-sm font-medium">{t('noneTitle')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div
          className={cn(
            'space-y-1 rounded-lg border p-3',
            recommended === 'direct' && 'border-foreground bg-muted/60',
          )}
        >
          <Button
            size="sm"
            variant={recommended === 'direct' ? 'default' : 'outline'}
            disabled={direct.isPending}
            onClick={() => void answerDirectly()}
          >
            {t('direct')}
          </Button>
          <p className="text-muted-foreground text-[13px]">{t('directNote')}</p>
        </div>
        <div
          className={cn(
            'space-y-1 rounded-lg border p-3',
            recommended === 'incubate' && 'border-foreground bg-muted/60',
          )}
        >
          <Button
            size="sm"
            variant={recommended === 'incubate' ? 'default' : 'outline'}
            disabled={incubate.isPending || incubate.isSuccess}
            onClick={() => incubate.mutate(null)}
          >
            {t('incubate')}
          </Button>
          <p className="text-muted-foreground text-[13px]">{t('incubateNote')}</p>
        </div>
      </div>
      {result.recommend ? (
        <p className="text-[13px]" data-testid="find-recommend">
          {t('recommend', {
            action: t(result.recommend.action === 'direct' ? 'direct' : 'incubate'),
            reason: result.recommend.reason,
          })}
        </p>
      ) : null}
      {incubate.isSuccess ? (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {t('incubated', { title: incubate.data.title ?? result.question })}
        </p>
      ) : null}
      {direct.isError || incubate.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t('actionFailed')}
        </p>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        disabled={direct.isPending || incubate.isPending || publish.isPending}
        onClick={() => router.push(routes.project(locale, project))}
      >
        {t('finishHere')}
      </Button>
      <p className="text-muted-foreground text-xs">{t('finishHereNote')}</p>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">{t('demandTitle')}</summary>
        <p className="text-muted-foreground mt-1 text-[13px]">{t('demandLead')}</p>
        <label className="mt-2 block text-xs font-medium">
          {t('demandName')}
          <input
            className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="mt-2 block text-xs font-medium">
          {t('demandProblem')}
          <Textarea
            rows={3}
            maxLength={4000}
            value={problem}
            onChange={(event) => setProblem(event.target.value)}
          />
        </label>
        <Button
          size="sm"
          className="mt-2"
          disabled={!title.trim() || !problem.trim() || publish.isPending || publish.isSuccess}
          onClick={() => publish.mutate({ title: title.trim(), problem: problem.trim() })}
        >
          {t('publish')}
        </Button>
        {publish.isSuccess ? (
          <p role="status" className="mt-1 text-emerald-700 dark:text-emerald-400">
            {t('published')}
          </p>
        ) : publish.isError ? (
          <p role="alert" className="text-destructive mt-1">
            {t('actionFailed')}
          </p>
        ) : null}
      </details>
    </section>
  )
}
