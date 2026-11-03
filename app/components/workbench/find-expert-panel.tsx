'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  matchSelectionSchema,
  type ExpertPick,
  type FindResult,
  type Pack,
  type MatchSelection,
} from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { useAskIncubation, useDirectAnswer, useFindResult } from '@/lib/workbench/find-expert'
import { usePinKnowbot } from '@/lib/workbench/knowbots'
import { routes } from '@/lib/workbench/routes'
import { cn } from '@/lib/utils'

export type ChosenExpert = {
  pack: Pack
  match?: MatchSelection
  question: string
  project: string
  task: string
  reason: string
}

// 「ai去knowmart请回专家」的结果（请专家方案设计第 4.9 节）：你的模型按专家自己写的范围找，平台不排序。
// 免费匹配自动选中；收费候选由用户点击选中。这里只钉版，提交问题才创建分析委托。
// 都不合适：两件事都不自动做，你点哪件做哪件、可以都点，推荐的那件标出来、写一句理由。
export function FindExpertPanel({
  task,
  project,
  onSelect,
  expectedQuestion,
  onEdit,
}: {
  task: string
  project: string
  onSelect: (selection: ChosenExpert) => void
  expectedQuestion?: string
  onEdit?: (question: string) => void
}) {
  const t = useTranslations('findExpert')
  const { locale } = useWorkbench()
  const found = useFindResult(task)
  const data = found.data
  if (
    data &&
    (data.project_id !== project ||
      (expectedQuestion !== undefined && data.question !== expectedQuestion.trim()))
  )
    return (
      <p role="status" className="text-sm">
        {t('questionChanged')}
      </p>
    )
  if (found.isError)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-destructive text-sm">
          {t('failed')}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={found.isFetching}
          onClick={() => void found.refetch()}
        >
          {t('readAgain')}
        </Button>
      </div>
    )
  if (!data || !data.outcome) {
    const message = !data
      ? 'loading'
      : data.error || ['SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED'].includes(data.state)
        ? 'ended'
        : data.state === 'RUNNING'
          ? 'running'
          : data.state === 'RECEIVED' || data.state === 'QUEUED'
            ? 'queued'
            : data.state === 'VALIDATING'
              ? 'preparing'
              : data.state === 'WAITING'
                ? 'waiting'
                : 'statusUnknown'
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground" role="status">
          {t(message)}
        </p>
        {data ? (
          <Link href={routes.project(locale, project)} className="underline underline-offset-3">
            {t('viewTasks')}
          </Link>
        ) : null}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {t('matchedQuestion', { question: data.question })}
      </p>
      {data.requirements?.length ? (
        <ul className="list-disc pl-5 text-sm">
          {data.requirements.map((req) => (
            <li key={req.id}>
              {req.origin ? <span>{t(`requirementOrigin.${req.origin}`)} · </span> : null}
              {req.statement}
              {req.rationale ? <p className="text-muted-foreground">{req.rationale}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {data.method_proposals?.length ? (
        <section aria-label={t('methodSuggestions')} className="space-y-2 text-sm">
          <p className="font-medium">{t('methodSuggestions')}</p>
          <p className="text-muted-foreground">{t('methodSuggestionsHint')}</p>
          {data.method_proposals.map((proposal) => (
            <div key={proposal.id}>
              <p>{proposal.approach}</p>
              <p className="text-muted-foreground">{proposal.reason}</p>
            </div>
          ))}
        </section>
      ) : null}
      {data.outcome === 'clarify' ? (
        <div className="space-y-2">
          <p role="status" className="text-sm">
            {data.clarification}
          </p>
          {onEdit ? <ClarificationEditor key={data.task_id} result={data} onEdit={onEdit} /> : null}
        </div>
      ) : null}
      {onEdit ? (
        <Button size="sm" variant="outline" onClick={() => onEdit(data.question)}>
          {t('editQuestion')}
        </Button>
      ) : null}
      {data.outcome === 'none' || data.outcome === 'clarify' ? (
        <>
          <Coverage result={data} />
          <NoneCard result={data} task={task} project={project} />
        </>
      ) : (
        <Picks key={data.task_id} result={data} project={project} onSelect={onSelect} />
      )}
    </div>
  )
}

// A clarification edits the next request, never the completed match receipt.
// The user reviews it in the normal question entry before starting another paid search.
function ClarificationEditor({
  result,
  onEdit,
}: {
  result: FindResult
  onEdit: (question: string) => void
}) {
  const t = useTranslations('findExpert')
  const id = useId()
  const [question, setQuestion] = useState(result.question)
  const changed = question.trim() !== result.question.trim()
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <label htmlFor={id} className="text-sm font-medium">
        {t('clarifiedQuestion')}
      </label>
      <Textarea
        id={id}
        value={question}
        rows={4}
        maxLength={2000}
        aria-describedby={`${id}-hint`}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        {t('clarificationHint')}
      </p>
      <Button
        size="sm"
        disabled={!changed || !question.trim() || question.trim().length > 2000}
        onClick={() => onEdit(question.trim())}
      >
        {t('useClarification')}
      </Button>
    </section>
  )
}

function Coverage({ result }: { result: FindResult }) {
  const t = useTranslations('findExpert')
  return (
    <>
      {(result.picks ?? []).map((pick) => (
        <div key={`${pick.knowbot_id}@${pick.version}`} className="space-y-1 text-sm">
          <p>{pick.name}</p>
          {pick.declarations?.length ? (
            <div className="space-y-1">
              <p className="font-medium">{t('declarationBasis')}</p>
              {pick.declarations.map((e, i) => (
                <blockquote key={i}>{e.quote}</blockquote>
              ))}
              <p>{t('selectionLimits')}</p>
              {pick.limitations?.map((limit, i) => (
                <p key={i}>{limit}</p>
              ))}
            </div>
          ) : null}
          {pick.solution ? (
            <div className="space-y-1">
              <p className="font-medium">{t('solution')}</p>
              <p>{pick.solution.approach}</p>
              {pick.solution.data_conditions.length ? <p>{t('solutionData')}</p> : null}
              {pick.solution.data_conditions.map((condition, index) => (
                <p key={index}>{condition}</p>
              ))}
            </div>
          ) : null}
          {pick.coverage?.map((row) => (
            <p key={row.requirement_id}>
              {t(`coverage.${row.status}`)} ·{' '}
              {result.requirements?.find((req) => req.id === row.requirement_id)?.statement}：
              {row.reason}
            </p>
          ))}
          {pick.unresolved_conditions?.map((condition) => (
            <p key={condition}>{condition}</p>
          ))}
        </div>
      ))}
    </>
  )
}

function Picks({
  result,
  project,
  onSelect,
}: {
  result: FindResult
  project: string
  onSelect: (selection: ChosenExpert) => void
}) {
  const t = useTranslations('findExpert')
  const pin = usePinKnowbot()
  const started = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const inFlight = useRef(false)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const picks = result.picks ?? []

  async function summon(pick: ExpertPick) {
    if (inFlight.current) return
    inFlight.current = true
    setFailed(false)
    try {
      const match = [
        'knowbench/expert-match/v2',
        'knowbench/expert-match/v3',
        'knowbench/expert-match/v4',
      ].includes(result.contract ?? '')
        ? matchSelectionSchema.parse({
            match_task_id: result.match_task_id,
            match_artifact_version: result.match_artifact_version,
            question_revision: result.question_revision,
            knowbot_id: pick.knowbot_id,
            version: pick.version,
          })
        : undefined
      // 只选定并钉住，分析委托由问题页的提交按钮创建。
      const pack = await pin.mutateAsync(`${pick.knowbot_id}@${pick.version}`)
      if (!mounted.current) return
      setSelected(pack.id)
      onSelect({
        pack,
        match,
        question: result.question,
        project,
        task: result.task_id,
        reason: pick.reason,
      })
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      inFlight.current = false
    }
  }

  // 有合适的、不用另付钱：自动选中，不启动分析。
  const auto = result.outcome === 'summon' && picks[0]?.free ? picks[0] : undefined
  useEffect(() => {
    if (!auto || started.current) return
    started.current = true
    void summon(auto)
    // 只选中一次；summon 每次渲染都是新的，不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  return (
    <section className="space-y-2" aria-label={t('picksTitle')}>
      {auto ? (
        failed ? null : (
          <p className="text-sm" role="status">
            {t(selected ? 'selected' : 'summoning', { name: auto.name })}
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
                  disabled={pin.isPending}
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
            <Button size="sm" disabled={pin.isPending} onClick={() => void summon(auto)}>
              {t('retrySummon')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Coverage result={result} />
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
  const recommended = result.recommend?.action

  async function answerDirectly() {
    const conversation = await direct.mutateAsync({ project, question: result.question, task })
    router.push(routes.projectConversation(locale, project, conversation))
  }

  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label={t('noneTitle')}>
      <p className="text-sm font-medium">
        {t(result.outcome === 'clarify' ? 'clarifyTitle' : 'noneTitle')}
      </p>
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
        disabled={direct.isPending || incubate.isPending}
        onClick={() => router.push(routes.project(locale, project))}
      >
        {t('finishHere')}
      </Button>
      <p className="text-muted-foreground text-xs">{t('finishHereNote')}</p>
    </section>
  )
}
