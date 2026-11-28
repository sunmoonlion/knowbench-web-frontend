'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import type { RunAction } from '@/contracts/interaction'
import { useRunProjection } from '@/lib/interaction/use-run-projection'

type ReferenceWorkspaceProps = {
  runId: string
  csrfToken: string
}

export function ReferenceWorkspace({ runId, csrfToken }: ReferenceWorkspaceProps) {
  const t = useTranslations('interaction')
  const { snapshot, citations, streamState, queryError, isLoading, action } = useRunProjection(
    runId,
    csrfToken,
  )

  if (isLoading) {
    return <p aria-live="polite">{t('loading')}</p>
  }
  if (queryError || !snapshot) {
    return (
      <div className="border-destructive/40 bg-destructive/5 rounded-xl border p-4" role="alert">
        <p className="font-medium">{t('loadFailed')}</p>
        <p className="text-muted-foreground mt-1 text-sm">{t('loadFailedHint')}</p>
      </div>
    )
  }

  return (
    <section className="mt-8 space-y-4" aria-labelledby="reference-run-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            {t('referenceLabel')}
          </p>
          <h2 id="reference-run-title" className="mt-1 text-xl font-semibold">
            {snapshot.title}
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="bg-secondary rounded-full px-3 py-1" data-testid="run-status">
            {t(`status.${snapshot.status}`)}
          </span>
          <span className="text-muted-foreground" data-testid="stream-state">
            {t(`stream.${streamState}`)}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <article className="bg-card rounded-xl border p-5 shadow-sm">
          <h3 className="font-medium">{t('answer')}</h3>
          <p className="text-muted-foreground mt-3 min-h-20 whitespace-pre-wrap text-sm">
            {snapshot.summary || t('answerPending')}
          </p>
          {snapshot.required_action ? (
            <RequiredActionForm
              key={snapshot.required_action.action_id}
              action={snapshot.required_action}
              pending={action.isPending}
              failed={action.isError}
              onSubmit={action.mutate}
            />
          ) : null}
        </article>

        <aside className="bg-card rounded-xl border p-5 shadow-sm" aria-label={t('citations')}>
          <h3 className="font-medium">{t('citations')}</h3>
          {citations.length ? (
            <ol className="mt-3 space-y-3">
              {citations.map((citation, index) => (
                <li key={citation.evidence_id} className="text-sm">
                  <a className="font-medium underline underline-offset-4" href={citation.source_href}>
                    {citation.title ?? t('citationFallback', { index: index + 1 })}
                  </a>
                  <blockquote className="text-muted-foreground mt-1 line-clamp-4">
                    {citation.quote}
                  </blockquote>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">{t('citationsPending')}</p>
          )}
        </aside>
      </div>
    </section>
  )
}

function RequiredActionForm({
  action,
  pending,
  failed,
  onSubmit,
}: {
  action: { action_id: string; kind: 'confirmation' | 'input'; prompt: string }
  pending: boolean
  failed: boolean
  onSubmit: (command: RunAction) => void
}) {
  const t = useTranslations('interaction')
  const [value, setValue] = useState('')
  const submittedValue = action.kind === 'confirmation' ? 'confirm' : value.trim()

  return (
    <div className="bg-muted mt-5 rounded-lg p-4" data-testid="required-action">
      <p className="text-sm font-medium">{action.prompt}</p>
      {action.kind === 'input' ? (
        <label className="mt-3 block text-sm">
          <span className="sr-only">{t('responseLabel')}</span>
          <textarea
            className="bg-background min-h-24 w-full rounded-md border p-3"
            maxLength={4000}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t('responsePlaceholder')}
          />
        </label>
      ) : null}
      <button
        type="button"
        className="bg-primary text-primary-foreground mt-3 rounded-md px-4 py-2 text-sm disabled:opacity-50"
        disabled={pending || !submittedValue}
        onClick={() =>
          onSubmit({
            contract_version: 1,
            action_id: action.action_id,
            value: submittedValue,
          })
        }
      >
        {pending ? t('submitting') : t('confirmAction')}
      </button>
      {failed ? (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {t('actionFailed')}
        </p>
      ) : null}
    </div>
  )
}
