'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Review } from '@/contracts/workbench-v2'

export type ReviewAnswer = { decision: string; answer?: Record<string, unknown> }
// 这几种选项可以附一句话：拒绝附话 = 告诉它怎么改；停下 / 重做附话 = 这一步重做时的要求
const WITH_NOTE = new Set(['decline', 'cancel', 'rework'])

// 审查面：专家停下来问我。为什么停、哪几条没过、每个选项选了会怎样、问题保留到什么时候。
// 这些话都是后端写的；页面不自己编「选了会怎样」。
export function ReviewPanel({
  review,
  token,
  answering,
  failed,
  onAnswer,
}: {
  review: Review
  token: string | null
  answering: boolean
  failed: boolean
  onAnswer: (answer: ReviewAnswer) => void
}) {
  const t = useTranslations('expert')
  const format = useFormatter()
  const pending = review.pending
  const [note, setNote] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const questions = review.subject?.questions ?? []
  const isQuestion = review.kind === 'question'
  const complete = !isQuestion || questions.every((q) => (answers[q.id] ?? '').trim() !== '')
  const send = (decision: string) => {
    if (isQuestion) return onAnswer({ decision: 'answer', answer: { answers } })
    const text = note.trim()
    onAnswer(WITH_NOTE.has(decision) && text ? { decision, answer: { text } } : { decision })
  }
  const chosen = review.decision.decided
    ? (pending.options.find((option) => option.id === review.decision.chosen)?.label ??
      review.decision.chosen)
    : null
  return (
    <section
      aria-label={pending.title}
      className="mx-6 mb-6 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
    >
      <header>
        <h3 className="text-sm font-semibold">{pending.title}</h3>
        {review.why ? <p className="mt-1 text-[13px]">{review.why}</p> : null}
      </header>

      {review.failed.length > 0 ? (
        <div>
          <p className="text-muted-foreground text-xs font-medium">{t('review.failed')}</p>
          <ul className="mt-1 space-y-0.5 text-[13px]">
            {review.failed.map((check) => (
              <li key={check.label}>
                <span className="text-destructive font-medium">{check.label}</span>
                {check.message ? `：${check.message}` : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.subject?.after_decline ? (
        <p className="text-[13px] text-amber-900 dark:text-amber-200">{t('review.afterDecline')}</p>
      ) : null}
      {review.subject?.dependents?.length ? (
        <p className="text-muted-foreground text-[13px]">
          {t('review.dependents', {
            steps: review.subject.dependents.map((d) => d.title).join('、'),
          })}
        </p>
      ) : null}

      {chosen !== null || (isQuestion && review.decision.decided) ? (
        <p className="text-[13px] font-medium">
          {isQuestion ? t('review.answered') : t('review.decided', { choice: chosen ?? '' })}
        </p>
      ) : isQuestion ? (
        <div>
          <ol className="space-y-3">
            {questions.map((q) => (
              <li key={q.id}>
                <p className="text-[13px] font-medium">
                  {q.header ? <span className="text-muted-foreground mr-2">{q.header}</span> : null}
                  {q.question}
                </p>
                {q.options.length ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {q.options.map((o) => (
                      <Button
                        key={o.label}
                        size="sm"
                        variant={answers[q.id] === o.label ? 'default' : 'outline'}
                        title={o.description || undefined}
                        disabled={answering || token === null}
                        onClick={() => setAnswers({ ...answers, [q.id]: o.label })}
                      >
                        {o.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {q.is_secret ? (
                  <Input
                    type="password"
                    autoComplete="off"
                    value={answers[q.id] ?? ''}
                    onChange={(event) => setAnswers({ ...answers, [q.id]: event.target.value })}
                    aria-label={t('review.other')}
                    className="mt-1 text-[13px]"
                  />
                ) : q.is_other || q.options.length === 0 ? (
                  <Textarea
                    value={
                      q.options.some((o) => o.label === answers[q.id]) ? '' : (answers[q.id] ?? '')
                    }
                    onChange={(event) => setAnswers({ ...answers, [q.id]: event.target.value })}
                    rows={1}
                    aria-label={t('review.other')}
                    placeholder={t('review.other')}
                    className="mt-1 text-[13px]"
                  />
                ) : null}
              </li>
            ))}
          </ol>
          <Button
            size="sm"
            className="mt-3"
            disabled={answering || token === null || !complete}
            onClick={() => send('answer')}
          >
            {t('review.send')}
          </Button>
          {token === null ? (
            <p className="text-destructive mt-2 text-[13px]">{t('review.noToken')}</p>
          ) : null}
        </div>
      ) : (
        <div>
          <p className="text-muted-foreground text-xs font-medium">{t('review.choose')}</p>
          <p className="mt-1 text-[13px] whitespace-pre-line">{pending.question}</p>
          <ul className="mt-2 space-y-2">
            {pending.options.map((option) => (
              <li key={option.id} className="flex items-start gap-3">
                <Button
                  size="sm"
                  variant={
                    option.id === 'stop' || option.id === 'decline' || option.id === 'cancel'
                      ? 'outline'
                      : 'default'
                  }
                  disabled={answering || token === null}
                  onClick={() => send(option.id)}
                  className="shrink-0"
                >
                  {option.label}
                </Button>
                <span className="text-muted-foreground pt-1 text-[13px]">{option.consequence}</span>
              </li>
            ))}
          </ul>
          {pending.options.some((option) => WITH_NOTE.has(option.id)) ? (
            <div className="mt-2">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                aria-label={t('review.noteLabel')}
                placeholder={t('review.notePlaceholder')}
                className="text-[13px]"
              />
            </div>
          ) : null}
          {token === null ? (
            <p className="text-destructive mt-2 text-[13px]">{t('review.noToken')}</p>
          ) : null}
          {failed ? (
            <p role="alert" className="text-destructive mt-2 text-[13px]">
              {t('review.failedToSend')}
            </p>
          ) : null}
        </div>
      )}

      {review.validity.expires_at && chosen === null ? (
        <p className="text-muted-foreground border-t border-amber-200 pt-2 text-xs dark:border-amber-900">
          {t('review.expires', {
            date: format.dateTime(new Date(review.validity.expires_at), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
          {review.validity.after_expiry}
        </p>
      ) : null}
    </section>
  )
}
