'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { routes } from '@/lib/workbench/routes'
import { branchRoute, startReview, type BranchLink } from '@/lib/workbench/reviewer'

import { ReviewDecisions } from './review-decisions'

export function BranchRouteScreen({ link }: { link: BranchLink }) {
  const t = useTranslations('reviewRouting')
  const { csrfToken } = useWorkbench()
  const cache = useQueryClient()
  const key = ['branch-route', link]
  const query = useQuery({
    queryKey: key,
    queryFn: () => branchRoute(link, csrfToken),
    retry: false,
  })
  const [edit, setEdit] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (choice: { previous_revision: number; option_digest: string }) =>
      branchRoute(link, csrfToken, choice),
    onSuccess: (data) => {
      cache.setQueryData(key, data)
      setEdit(null)
    },
    onError: () => {
      void query.refetch()
    },
  })
  const locale = useLocale()
  const [session, setSession] = useState('')
  const [sourceKey, setSourceKey] = useState('')
  const execute = useMutation({
    mutationFn: (selection: Parameters<typeof startReview>[2]) =>
      startReview(link, csrfToken, selection),
    onSettled: () => query.refetch(),
  })
  const data = query.data
  const selected = edit ?? data?.confirmed ?? data?.recommended
  const choice = data?.options.find((o) => o.digest === selected)
  const execution = data?.execution
  const source =
    execution && 'sources' in execution
      ? execution.sources.find((s) => s.source_id + '/' + s.version === sourceKey)
      : undefined
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1>{t('confirmTitle')}</h1>
      {query.isPending && <p>{t('loading')}</p>}
      {(query.isError || save.isError) && <p role="alert">{t('refresh')}</p>}
      {data && !query.isError && (
        <>
          <p>
            {t('artifact')} · {data.artifact} · v{data.version} · {link.step}
          </p>
          <p>{t(data.requirement)}</p>
          {data.planned_producer && (
            <p>
              {t('producer')} · {data.planned_producer.provider} / {data.planned_producer.model}
            </p>
          )}
          {Object.keys(data.handoff).length > 0 && (
            <section>
              <h2>{t('firstRound')}</h2>
              <ul>
                {Object.entries(data.handoff).map(([name, hash]) => (
                  <li key={name} className="break-all">
                    {name} · {hash}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.deferred && (
            <p className="break-all">
              {t('deferred')} · {data.deferred.assessment_output} ·{' '}
              {data.deferred.assessment_digest}
            </p>
          )}
          {data.gap && <p role="status">{t.has(data.gap) ? t(data.gap) : t('unavailable')}</p>}
          {data.options.length > 0 && (
            <label>
              {t('reviewer')}{' '}
              <select
                value={choice?.digest ?? ''}
                disabled={
                  save.isPending || execute.isPending || !!(execution && 'task_id' in execution)
                }
                onChange={(e) => setEdit(e.target.value)}
              >
                <option value="">{t('choose')}</option>
                {data.options.map((o) => (
                  <option key={o.digest} value={o.digest}>
                    {o.pin.provider} / {o.pin.model} · {o.destination} ·{' '}
                    {o.pin.credential_id.slice(-8)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {choice && (
            <>
              <p>
                {choice.destination} · {choice.family ?? t('family_unverified')}
              </p>
              <p>
                {t('ceiling', {
                  rounds: data.rounds,
                  amount: choice.maximum,
                  currency: choice.currency,
                  date: choice.price_as_of,
                })}
              </p>
              {data.confirmed === choice.digest ? (
                <p role="status">{t('confirmed')}</p>
              ) : (
                <Button
                  type="button"
                  disabled={save.isPending || query.isFetching}
                  onClick={() =>
                    save.mutate({ previous_revision: data.revision, option_digest: choice.digest })
                  }
                >
                  {t('confirm')}
                </Button>
              )}
            </>
          )}
          {execution && 'task_id' in execution && execution.sealed_findings && (
            <p className="break-all">
              {t('sealedFindings', { version: execution.sealed_findings.version })} ·{' '}
              {execution.sealed_findings.digest}
            </p>
          )}
          {execution && 'task_id' in execution ? (
            <Link
              className="underline"
              href={routes.projectConversation(locale, execution.project_id, execution.session_id)}
            >
              {t('openReview')} · {execution.task_id.slice(-8)}
            </Link>
          ) : execution && 'sessions' in execution && choice && choice.digest === data.confirmed ? (
            <section className="space-y-2">
              <p>{t(data.rounds === 2 ? 'sendBothRounds' : 'sendScope')}</p>
              {execution.sources.length && execution.sessions.length ? (
                <>
                  <label>
                    {t('instruction')}{' '}
                    <select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
                      <option value="">{t('select')}</option>
                      {execution.sources.map((s) => (
                        <option
                          key={s.source_id + '/' + s.version}
                          value={s.source_id + '/' + s.version}
                        >
                          {s.name} · v{s.version} · {s.digest.slice(-8)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('session')}{' '}
                    <select value={session} onChange={(e) => setSession(e.target.value)}>
                      <option value="">{t('select')}</option>
                      {execution.sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title || t('session')} · {s.id.slice(-8)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    disabled={!source || !session || execute.isPending || query.isFetching}
                    onClick={() => {
                      if (source && data.confirmed)
                        execute.mutate({
                          session_id: session,
                          source_id: source.source_id,
                          version: source.version,
                          digest: source.digest,
                          revision: data.revision,
                          option_digest: data.confirmed,
                        })
                    }}
                  >
                    {t(data.rounds === 2 ? 'startComparison' : 'startReview')}
                  </Button>
                </>
              ) : (
                <p>{t('missingInputs')}</p>
              )}
            </section>
          ) : (
            <p>
              {t(
                execution && 'unavailable' in execution
                  ? execution.unavailable
                  : 'pendingIsolation',
              )}
            </p>
          )}
          {execution &&
            'task_id' in execution &&
            ['SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED'].includes(execution.state) && (
              <ReviewDecisions key={execution.task_id} task={execution.task_id} />
            )}
          {execute.isError && <p role="alert">{t('refresh')}</p>}
        </>
      )}
      <Button
        variant="outline"
        disabled={query.isFetching || save.isPending}
        onClick={() => {
          setEdit(null)
          void query.refetch()
        }}
      >
        {t('reload')}
      </Button>
    </main>
  )
}
