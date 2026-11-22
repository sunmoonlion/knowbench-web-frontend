'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import {
  reviewDecisions,
  saveDecisions,
  type DecisionItem,
  type DecisionView,
} from '@/lib/workbench/reviewer'

export function ReviewDecisions({ task }: { task: string }) {
  const t = useTranslations('reviewRouting')
  const [revision, setRevision] = useState<number>()
  const query = useQuery({
    queryKey: ['review-decisions', task, revision],
    queryFn: () => reviewDecisions(task, revision),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const data = query.data
  return (
    <section className="space-y-3">
      <h2>{t('decisionTitle')}</h2>
      {query.isPending && <p>{t('loading')}</p>}
      {query.isError && <button onClick={() => void query.refetch()}>{t('reload')}</button>}
      {data && (
        <>
          {data.missing_stages.length > 0 && (
            <p role="status">
              {t('missingStages', {
                stages: data.missing_stages
                  .map((stage) => t(stage === 'direct' ? 'independentReport' : 'comparisonReport'))
                  .join(' / '),
              })}
            </p>
          )}
          {data.reports.map((r) => (
            <details key={r.id} open>
              <summary>
                {t(r.step === 'direct' ? 'independentReport' : 'comparisonReport')} · v{r.version}
              </summary>
              <p className="break-words whitespace-pre-wrap">{r.text}</p>
            </details>
          ))}
          {data.revision > 0 && <p>{t('decisionRevision', { revision: data.revision })}</p>}
          {data.revision > 1 && (
            <Button variant="outline" onClick={() => setRevision(data.revision - 1)}>
              {t('previousDecision')}
            </Button>
          )}
          {revision !== undefined && (
            <Button variant="outline" onClick={() => setRevision(undefined)}>
              {t('latestDecision')}
            </Button>
          )}
          {revision === undefined && data.reports.some((r) => r.text.trim()) ? (
            <DecisionEditor
              key={task + '/' + data.revision}
              task={task}
              data={data}
              reload={() => query.refetch()}
            />
          ) : (
            data.items.map((i, n) => (
              <p key={n}>
                {i.quote} · {t(i.decision === 'deferred' ? 'deferDecision' : i.decision)} ·{' '}
                {i.reason}
              </p>
            ))
          )}
        </>
      )}
    </section>
  )
}

function DecisionEditor({
  task,
  data,
  reload,
}: {
  task: string
  data: DecisionView
  reload: () => Promise<unknown>
}) {
  const t = useTranslations('reviewRouting')
  const { csrfToken } = useWorkbench()
  const cache = useQueryClient()
  const empty = (): DecisionItem => ({
    artifact_id: data.reports[0].id,
    quote: '',
    decision: 'deferred',
    reason: '',
  })
  const [items, setItems] = useState<DecisionItem[]>(() =>
    data.items.length ? data.items : [empty()],
  )
  const save = useMutation({
    mutationFn: () =>
      saveDecisions(task, csrfToken, {
        previous_revision: data.revision,
        review_digest: data.review_digest,
        items,
      }),
    onSuccess: (next) => cache.setQueryData(['review-decisions', task, undefined], next),
  })
  function patch(index: number, changes: Partial<DecisionItem>) {
    setItems((rows) => rows.map((row, n) => (n === index ? { ...row, ...changes } : row)))
  }
  const valid =
    items.every(
      (i) =>
        i.quote.trim() &&
        i.reason.trim() &&
        data.reports.some((r) => r.id === i.artifact_id && r.text.includes(i.quote)),
    ) && new Set(items.map((i) => JSON.stringify([i.artifact_id, i.quote]))).size === items.length
  return (
    <fieldset className="space-y-3" disabled={save.isPending}>
      {items.map((i, n) => (
        <fieldset key={n} className="grid gap-2 rounded border p-3">
          <legend>{t('findingNumber', { number: n + 1 })}</legend>
          {data.reports.length > 1 && (
            <label>
              {t('reportSource')}
              <select
                value={i.artifact_id}
                onChange={(e) => patch(n, { artifact_id: e.target.value, quote: '' })}
              >
                {data.missing_stages.length > 0 && (
                  <p role="status">
                    {t('missingStages', {
                      stages: data.missing_stages
                        .map((stage) =>
                          t(stage === 'direct' ? 'independentReport' : 'comparisonReport'),
                        )
                        .join(' / '),
                    })}
                  </p>
                )}
                {data.reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t(r.step === 'direct' ? 'independentReport' : 'comparisonReport')}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t('exactQuote')}
            <textarea
              className="block w-full border"
              maxLength={2000}
              value={i.quote}
              onChange={(e) => patch(n, { quote: e.target.value })}
            />
          </label>
          <label>
            {t('findingDecision')}{' '}
            <select
              value={i.decision}
              onChange={(e) => patch(n, { decision: e.target.value as DecisionItem['decision'] })}
            >
              {(['accepted', 'declined', 'deferred'] as const).map((d) => (
                <option value={d} key={d}>
                  {t(d === 'deferred' ? 'deferDecision' : d)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('decisionReason')}
            <textarea
              className="block w-full border"
              maxLength={1000}
              value={i.reason}
              onChange={(e) => patch(n, { reason: e.target.value })}
            />
          </label>
          {items.length > 1 && (
            <Button variant="outline" onClick={() => setItems(items.filter((_, j) => j !== n))}>
              {t('removeFinding')}
            </Button>
          )}
        </fieldset>
      ))}
      <Button
        variant="outline"
        disabled={items.length >= 32}
        onClick={() => setItems([...items, empty()])}
      >
        {t('addFinding')}
      </Button>
      <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
        {t('saveDecisions')}
      </Button>
      {save.isError && (
        <p role="alert">
          {t('decisionConflict')} <button onClick={() => void reload()}>{t('reload')}</button>
        </p>
      )}
    </fieldset>
  )
}
