'use client'

import { CheckIcon, LoaderIcon, MinusIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { Attempt, Now, RunSheet, RunStep } from '@/contracts/workbench-v2'
import { money, symbol, toMicros } from '@/lib/workbench/money'
import { cn } from '@/lib/utils'

import { MARK, minutesAndSeconds, plain, reassurance, shape } from '../model/run'

export function useDuration() {
  const t = useTranslations('expert')
  return (total: number) => {
    const { minutes, seconds } = minutesAndSeconds(total)
    return minutes > 0 ? t('time.minutes', { minutes, seconds }) : t('time.seconds', { seconds })
  }
}

export function amountText(amount: string, currency: string) {
  const micros = toMicros(amount)
  return micros === null ? amount : `${symbol(currency)}${money(micros)}`
}

export function TaskPlan({ plan, live }: { plan: RunSheet['plan']; live: boolean }) {
  const t = useTranslations('expert.plan')
  if (!plan) return null
  return (
    <section className="shrink-0 border-b px-4 py-3 text-sm" aria-label={t('label')}>
      <p className="font-medium">
        {plan.planning
          ? t('planning')
          : plan.version !== null
            ? t('version', { version: plan.version })
            : live
              ? t('pending')
              : t('unavailable')}
      </p>
      {plan.reason ? (
        <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{plan.reason}</p>
      ) : null}
      {plan.history.length > 1 ? (
        <details className="mt-2">
          <summary className="cursor-pointer">{t('history')}</summary>
          <ol className="mt-2 space-y-1">
            {plan.history.map((entry) => (
              <li key={entry.version}>
                {t('version', { version: entry.version })}：{entry.reason}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  )
}

// 现在在干什么、为什么、没有卡住。专家处理期间一直摆着。
export function NowStrip({ now, clock }: { now: Now; clock: number }) {
  const t = useTranslations('expert')
  const duration = useDuration()
  const calm = reassurance(now, clock)
  const waiting = calm.line === null
  return (
    <section
      aria-label={t('now.label')}
      className={cn(
        'shrink-0 border-b px-4 py-3',
        waiting ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-muted/30',
      )}
    >
      <p className="flex items-center gap-2 text-sm font-medium" role="status">
        {waiting ? null : <LoaderIcon className="size-3.5 shrink-0 animate-spin" />}
        {now.doing.text}
      </p>
      {now.step.why ? (
        <p className="mt-1 text-[13px] leading-6">
          <span className="text-muted-foreground">{t('now.why')}：</span>
          {now.step.why}
        </p>
      ) : null}
      {now.redo ? (
        <p className="mt-0.5 text-[13px] text-amber-700 dark:text-amber-400">{now.redo}</p>
      ) : null}
      {calm.line ? (
        <p
          className={cn(
            'text-muted-foreground mt-0.5 text-[13px]',
            calm.line === 'unheld' && 'text-amber-700 dark:text-amber-400',
          )}
        >
          {t('now.elapsed', { time: duration(calm.elapsed) })}
          {' · '}
          {t(`now.${calm.line}`, { time: duration(calm.quiet) })}
        </p>
      ) : null}
    </section>
  )
}

// 步骤轨：每一步一个记号。点哪一步，中间就显示哪一步。
export function StepRail({
  steps,
  shown,
  onPick,
}: {
  steps: RunStep[]
  shown: number | null
  onPick: (index: number) => void
}) {
  const t = useTranslations('expert')
  return (
    <nav aria-label={t('rail.title')} className="w-56 shrink-0 overflow-y-auto border-r p-3">
      <h2 className="text-muted-foreground px-2 pb-1 text-xs font-medium">{t('rail.title')}</h2>
      <ol>
        {steps.map((step) => (
          <li key={step.index}>
            <button
              type="button"
              onClick={() => onPick(step.index)}
              aria-current={shown === step.index ? 'step' : undefined}
              title={t(`status.${step.status}`)}
              className={cn(
                'hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                shown === step.index && 'bg-muted font-medium',
                (step.status === 'pending' || step.status === 'not_reached') &&
                  'text-muted-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'w-4 shrink-0 text-center',
                  step.status === 'accepted' && 'text-green-700 dark:text-green-400',
                  (step.status === 'waiting' || step.status === 'reworking') && 'text-amber-600',
                  step.status === 'failed' && 'text-destructive',
                )}
              >
                {MARK[step.status]}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {step.index} {step.title}
              </span>
              {step.times > 1 ? (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t('rail.times', { n: step.times })}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function Returned({ attempt }: { attempt: Attempt }) {
  const t = useTranslations('expert')
  const returned = attempt.returned
  if (!returned) return <p className="text-muted-foreground text-[13px]">{t('detail.noReturn')}</p>
  if (returned.content === null || returned.content === undefined) {
    return returned.raw ? (
      <div className="text-[13px]">
        <p className="text-destructive">{t('detail.raw')}</p>
        <pre className="bg-muted mt-1 max-h-48 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
          {returned.raw}
        </pre>
      </div>
    ) : (
      <p className="text-muted-foreground text-[13px]">{t('detail.noReturn')}</p>
    )
  }
  const word = (key: string) => returned.labels?.[key] ?? key
  return (
    <div className="space-y-3">
      {shape(returned.content).map((part) =>
        part.kind === 'table' ? (
          <div key={part.key} className="overflow-x-auto rounded-md border">
            <table className="w-full text-[13px]">
              <caption className="text-muted-foreground border-b px-2 py-1 text-left text-xs">
                {word(part.key)}
              </caption>
              <thead>
                <tr className="bg-muted/50 text-left">
                  {part.columns.map((column) => (
                    <th key={column} className="px-2 py-1 text-xs font-normal">
                      {word(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {part.rows.map((row, index) => (
                  <tr key={index} className="border-t">
                    {row.map((cell, at) => (
                      <td key={at} className="px-2 py-1 align-top tabular-nums">
                        {plain(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {part.more ? (
              <p className="text-muted-foreground border-t px-2 py-1 text-xs">
                {t('detail.more', { n: part.more })}
              </p>
            ) : null}
          </div>
        ) : (
          <dl key={part.key} className="grid grid-cols-[10rem_1fr] gap-x-3 text-[13px]">
            <dt className="text-muted-foreground truncate text-xs leading-6">{word(part.key)}</dt>
            <dd className="min-w-0 break-words">
              {part.kind === 'value' ? part.value : part.items.length ? part.items.join('；') : '—'}
            </dd>
          </dl>
        ),
      )}
    </div>
  )
}

function Checks({ attempt }: { attempt: Attempt }) {
  const t = useTranslations('expert')
  return (
    <ul className="space-y-1 text-[13px]">
      {attempt.checks.map((check) => (
        <li key={check.label} className="flex items-start gap-2">
          {check.pass === true ? (
            <CheckIcon
              className="mt-0.5 size-3.5 shrink-0 text-green-700 dark:text-green-400"
              aria-label={t('check.pass')}
            />
          ) : check.pass === false ? (
            <XIcon
              className="text-destructive mt-0.5 size-3.5 shrink-0"
              aria-label={t('check.fail')}
            />
          ) : (
            <MinusIcon
              className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
              aria-label={t('check.skipped')}
            />
          )}
          <span className={cn(check.pass === false && 'text-destructive font-medium')}>
            {check.label}
            {check.pass === false && check.message ? (
              <span className="font-normal">：{check.message}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

// 中间：一步的细节。用了什么、每一次交回了什么、验收的每一条。
export function StepDetail({ step, loading }: { step: RunStep | undefined; loading: boolean }) {
  const t = useTranslations('expert')
  if (!step) {
    return <p className="text-muted-foreground p-6 text-sm">{loading ? t('detail.loading') : ''}</p>
  }
  const tools = [...new Set(step.attempts.flatMap((attempt) => Object.entries(attempt.tools)))]
  const heading = 'text-muted-foreground mb-1.5 text-xs font-medium'
  return (
    <article className="space-y-5 p-6">
      <header>
        <p className="text-muted-foreground text-xs">
          {t('detail.step', { index: step.index })} · {t(`status.${step.status}`)}
        </p>
        <h2 className="mt-0.5 text-lg font-semibold">{step.title}</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">{step.summary}</p>
        {step.selection_reason ? (
          <p className="mt-2 text-sm">
            {t('plan.selectedBecause')}：{step.selection_reason}
          </p>
        ) : null}
        {step.current_result ? (
          <p className="text-muted-foreground mt-1 text-xs">
            {t('plan.currentResult', { version: step.current_result.version })}
          </p>
        ) : step.current_result === null &&
          step.attempts.some((attempt) => attempt.outcome === 'accepted') ? (
          <p className="mt-1 text-xs">{t('plan.historicalResult')}</p>
        ) : null}
      </header>

      <section>
        <h3 className={heading}>{t('detail.uses')}</h3>
        <ul className="space-y-0.5 text-[13px]">
          {step.uses.length === 0 ? <li>{t('detail.usesInput')}</li> : null}
          {step.uses.map((use) => (
            <li key={use.title}>
              {use.step ? t('detail.usesStep', { step: use.step, title: use.title }) : use.title}
            </li>
          ))}
          {tools.length > 0 ? (
            <li>
              {t('detail.tools')}：{tools.map(([name, count]) => `${name} ×${count}`).join('、')}
            </li>
          ) : null}
          {step.data?.dataset ? (
            <li>
              {t('detail.data')}：
              {t('detail.dataLine', {
                dataset: step.data.dataset,
                version: (step.data.data_version ?? '').slice(-8),
                asOf: step.data.as_of ?? '—',
              })}
            </li>
          ) : null}
        </ul>
      </section>

      {step.attempts.length === 0 ? (
        <section className="space-y-3">
          <p className="text-muted-foreground text-sm">{t('detail.notYet')}</p>
          <div>
            <h3 className={heading}>{t('detail.willCheck')}</h3>
            <ul className="list-disc pl-5 text-[13px]">
              {step.checks.map((check) => (
                <li key={check.label}>{check.label}</li>
              ))}
            </ul>
          </div>
          <p className="text-[13px]">
            <span className="text-muted-foreground">{t('detail.afterRejection')}：</span>
            {step.after_rejection.text}
          </p>
        </section>
      ) : (
        step.attempts.map((attempt) => (
          <section key={attempt.attempt_id} className="space-y-3 rounded-lg border p-4">
            {step.attempts.length > 1 || attempt.outcome !== 'accepted' ? (
              <p className="text-[13px] font-medium">
                {t('detail.attempt', { n: attempt.n })}，
                <span
                  className={cn(
                    attempt.outcome === 'rejected' || attempt.outcome === 'failed'
                      ? 'text-destructive'
                      : undefined,
                  )}
                >
                  {t.has(`outcome.${attempt.outcome}`)
                    ? t(`outcome.${attempt.outcome}`)
                    : attempt.outcome}
                </span>
              </p>
            ) : null}
            <div>
              <h3 className={heading}>{t('detail.returned')}</h3>
              <Returned attempt={attempt} />
            </div>
            {attempt.outcome !== 'running' ? (
              <div>
                <h3 className={heading}>{t('detail.checks')}</h3>
                <Checks attempt={attempt} />
              </div>
            ) : null}
          </section>
        ))
      )}
    </article>
  )
}
