'use client'

import { ChevronRightIcon, LoaderIcon, ShieldAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Markdown } from '@/components/common/markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { MissingDataCard } from '@/components/workbench/missing-data-card'
import { ChangeLine, StepLine } from '@/components/workbench/step-line'
import type { Waiting } from '@/contracts/workbench-v2'
import { relativeTo } from '@/lib/workbench/items'
import { cn } from '@/lib/utils'

import { phaseTally, type Approval, type Entry, type Question } from '../model/timeline'

export type Answer = { decision: string; answer?: Record<string, unknown> }

// 一段过程：它说了一句要做什么，接着跑了几条命令。收成一行，点开才看细节。
function Phase({ entry }: { entry: Extract<Entry, { kind: 'phase' }> }) {
  const t = useTranslations('work')
  const [open, setOpen] = useState(false)
  const counted = phaseTally(entry.steps)
  const parts = [
    counted.commands ? t('phase.commands', { count: counted.commands }) : null,
    counted.data ? t('phase.data', { count: counted.data }) : null,
    counted.failed ? t('phase.failed', { count: counted.failed }) : null,
  ].filter(Boolean)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm"
      >
        {counted.running ? (
          <LoaderIcon className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <ChevronRightIcon
            className={cn(
              'text-muted-foreground size-3.5 shrink-0 transition-transform',
              open && 'rotate-90',
            )}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.said ?? t('phase.untitled')}</span>
        <span className="text-muted-foreground shrink-0 text-[13px]">{parts.join(' · ')}</span>
      </button>
      {open ? (
        <div className="mt-0.5 ml-2 space-y-0.5 border-l pl-3">
          {entry.steps.map((step) => (
            <StepLine key={`${step.kind}:${step.id}`} step={step} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// 等你批准：命令、在哪个目录、它的理由，都摆出来；能选什么由后端给（四个按钮：允许一次 /
// 这个任务里都允许 / 拒绝这一步 / 停下，approval.md「问人怎么问」）。拒绝和停下可以附一句话：
// 拒绝附话 = 拒绝并告诉它怎么改；停下附话 = 这一步重做时的要求。
function ApprovalCard({
  approval,
  waiting,
  answering,
  onAnswer,
}: {
  approval: Approval
  waiting: Waiting | undefined
  answering: boolean
  onAnswer: (approval: Approval, answer: Answer) => void
}) {
  const t = useTranslations('work')
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  if (approval.state !== 'pending') {
    const known = ['accept', 'accept_task', 'acceptForSession', 'decline', 'cancel'].includes(
      approval.decision ?? '',
    )
    return (
      <Marker>
        <MarkerContent>
          {approval.state === 'expired'
            ? t('approval.expired')
            : t(`approval.answered.${known ? approval.decision : 'other'}`)}
          <span className="ml-2 font-mono text-xs">{approval.command}</span>
        </MarkerContent>
      </Marker>
    )
  }
  const options =
    waiting?.prompt.options ??
    (approval.options.length
      ? approval.options
      : [
          { id: 'accept', label: t('approval.answered.accept') },
          { id: 'decline', label: t('approval.answered.decline') },
        ])
  const send = (id: string) =>
    onAnswer(
      approval,
      note.trim() ? { decision: id, answer: { text: note.trim() } } : { decision: id },
    )
  return (
    <section
      aria-label={t('approval.title')}
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
    >
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlertIcon className="size-4 shrink-0" />
        {t('approval.title')}
      </p>
      {approval.afterDecline ? (
        <p className="mt-1 text-[13px] text-amber-900 dark:text-amber-200">
          {t('approval.afterDecline')}
        </p>
      ) : null}
      <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">{t('approval.command')}</dt>
        <dd className="font-mono break-all">{approval.command}</dd>
        {approval.cwd ? (
          <>
            <dt className="text-muted-foreground">{t('approval.where')}</dt>
            <dd className="font-mono break-all">{approval.cwd}</dd>
          </>
        ) : null}
        {approval.reason ? (
          <>
            <dt className="text-muted-foreground">{t('approval.reason')}</dt>
            <dd>{approval.reason}</dd>
          </>
        ) : null}
        {approval.step ? (
          <>
            <dt className="text-muted-foreground">{t('approval.step')}</dt>
            <dd>
              {t('approval.stepAt', { index: approval.step.index, title: approval.step.title })}
              {approval.dependents.length ? (
                <span className="text-muted-foreground block">
                  {t('approval.dependents', {
                    steps: approval.dependents.map((d) => d.title).join('、'),
                  })}
                </span>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option.id === 'decline' || option.id === 'cancel' ? 'outline' : 'default'}
            disabled={answering}
            onClick={() => send(option.id)}
          >
            {option.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={answering}
          aria-pressed={noteFor !== null}
          onClick={() => setNoteFor(noteFor === null ? 'note' : null)}
        >
          {t('approval.noteToggle')}
        </Button>
      </div>
      {noteFor !== null ? (
        <div className="mt-2">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            aria-label={t('approval.noteLabel')}
            placeholder={t('approval.notePlaceholder')}
            className="text-[13px]"
          />
          <p className="text-muted-foreground mt-1 text-xs">{t('approval.noteHint')}</p>
        </div>
      ) : null}
    </section>
  )
}

// Codex 问你：每题给选项，也能自己写；答完一起发回去
function QuestionCard({
  question,
  answering,
  onAnswer,
}: {
  question: Question
  answering: boolean
  onAnswer: (answer: Answer & { id: string; token: string }) => void
}) {
  const t = useTranslations('work')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  if (question.state !== 'pending') {
    return (
      <Marker>
        <MarkerContent>
          {question.state === 'expired' ? t('question.expired') : t('question.answered')}
        </MarkerContent>
      </Marker>
    )
  }
  const complete = question.questions.every((q) => (answers[q.id] ?? '').trim() !== '')
  return (
    <section
      aria-label={t('question.title')}
      className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/40"
    >
      <p className="font-medium">{question.title || t('question.title')}</p>
      <ol className="mt-2 space-y-3">
        {question.questions.map((q) => (
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
                    disabled={answering}
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
                aria-label={t('question.secret')}
                placeholder={t('question.secret')}
                className="mt-1 text-[13px]"
              />
            ) : q.is_other || q.options.length === 0 ? (
              <Textarea
                value={
                  q.options.some((o) => o.label === answers[q.id]) ? '' : (answers[q.id] ?? '')
                }
                onChange={(event) => setAnswers({ ...answers, [q.id]: event.target.value })}
                rows={1}
                aria-label={t('question.other')}
                placeholder={t('question.other')}
                className="mt-1 text-[13px]"
              />
            ) : null}
          </li>
        ))}
      </ol>
      <div className="mt-3">
        <Button
          size="sm"
          disabled={answering || !complete}
          onClick={() =>
            onAnswer({
              id: question.id,
              token: question.token,
              decision: 'answer',
              answer: { answers },
            })
          }
        >
          {t('question.send')}
        </Button>
      </div>
    </section>
  )
}

export function TimelineEntry({
  entry,
  directory,
  waiting,
  answering,
  onAnswer,
  onQuestion,
  onOpenDossier,
}: {
  entry: Entry
  directory: string | null
  waiting: Waiting[]
  answering: boolean
  onAnswer: (approval: Approval, answer: Answer) => void
  onQuestion?: (answer: Answer & { id: string; token: string }) => void
  // 专家交回那一行的「打开工作底稿」：页面把右边栏切到那一栏
  onOpenDossier?: () => void
}) {
  const t = useTranslations('work')
  const tc = useTranslations('conversation')
  switch (entry.kind) {
    case 'user':
      return (
        <div className="bg-muted rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
          {entry.text}
        </div>
      )
    case 'model':
      return <Markdown>{entry.text}</Markdown>
    case 'phase':
      return <Phase entry={entry} />
    case 'change':
      return (
        <div className="rounded-lg border px-1.5 py-1">
          {entry.step.files.map((file) => (
            <ChangeLine
              key={file.path}
              file={file}
              path={relativeTo(directory, file.path)}
              running={entry.step.running}
              failed={entry.step.failed}
            />
          ))}
        </div>
      )
    case 'approval':
      return (
        <ApprovalCard
          approval={entry.approval}
          waiting={waiting.find((each) => each.id === entry.approval.id)}
          answering={answering}
          onAnswer={onAnswer}
        />
      )
    case 'question':
      return (
        <QuestionCard
          question={entry.question}
          answering={answering}
          onAnswer={(answer) => onQuestion?.(answer)}
        />
      )
    case 'policy':
      return (
        <Marker className={entry.decision === 'decline' ? 'text-destructive' : undefined}>
          <MarkerContent>
            {t(entry.decision === 'decline' ? 'policy.denied' : 'policy.allowed', {
              command: entry.command,
            })}
          </MarkerContent>
        </Marker>
      )
    case 'local': {
      const scope = [
        t(`local.sandbox.${entry.sandbox}`),
        t(entry.network ? 'local.network.on' : 'local.network.off'),
      ].join(t('local.join'))
      return (
        <Marker>
          <MarkerContent>
            {t(entry.decision === 'approved' ? 'local.approved' : 'local.denied', {
              scope,
              digest: entry.digest,
            })}
          </MarkerContent>
        </Marker>
      )
    }
    case 'missing':
      return <MissingDataCard code={entry.code} dataset={entry.dataset} />
    case 'handover':
      return (
        <div className="space-y-2">
          <Marker variant="separator">
            <MarkerContent>{t(`handover.${entry.what}`)}</MarkerContent>
          </Marker>
          {entry.what === 'returned' ? (
            <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[13px]">
              <span>
                {entry.outcome === 'rejected'
                  ? entry.reason
                    ? t('handover.rejected', { reason: entry.reason })
                    : t('handover.rejectedPlain')
                  : t(
                      `handover.${entry.outcome ?? 'failed'}${entry.writesFiles === false ? 'NoFiles' : ''}`,
                    )}
              </span>
              {onOpenDossier && entry.outcome !== 'rejected' && entry.writesFiles !== false ? (
                <Button variant="link" size="sm" className="h-auto p-0" onClick={onOpenDossier}>
                  {t('handover.open')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )
    case 'stage':
      return (
        <p className="text-muted-foreground pt-1 text-[13px] font-medium">
          {t('handover.stage', { title: entry.title })}
        </p>
      )
    case 'notice':
      return (
        <Marker className={entry.what === 'failed' ? 'text-destructive' : undefined}>
          <MarkerContent>{tc(entry.what === 'stopped' ? 'stopped' : 'failed')}</MarkerContent>
        </Marker>
      )
  }
}
