import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { readExecutionPreview, submitExecution } from '../api/formal-expert-preparation'

export function ExecutionPreview({
  task,
  revision,
  hasEnvelope = false,
  onConfirmed,
}: {
  task: string
  revision: number
  hasEnvelope?: boolean
  onConfirmed: () => void
}) {
  const t = useTranslations('formalIntake')
  const [acceptEnvelope, setAcceptEnvelope] = useState(true)
  const read = useMutation({
    mutationFn: async () => {
      const data = await readExecutionPreview(task, revision)
      if (data.task_id !== task || data.revision !== revision)
        throw new Error('Unexpected revision')
      return data
    },
    retry: false,
  })
  const { csrfToken } = useWorkbench()
  const submit = useMutation({
    mutationFn: (fingerprint: string) =>
      submitExecution(
        task,
        revision,
        fingerprint,
        csrfToken,
        hasEnvelope && acceptEnvelope ? true : undefined,
      ),
    onSuccess: onConfirmed,
    retry: false,
  })
  const result = read.data
  return (
    <section className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={read.isPending}
        onClick={() => read.mutate()}
      >
        {t('checkExecution')}
      </Button>
      {submit.isError && <p role="alert">{t('confirmationFailed')}</p>}
      {read.isError && <p role="alert">{t('previewFailed')}</p>}
      {result && (
        <>
          {result.object_batch && (
            <section>
              <p>
                {t('batchScope', {
                  count: result.object_batch.members.length,
                  maximum: result.object_batch.maximum,
                })}
              </p>
              <p>{t(result.object_batch.on_missing === 'stop' ? 'batchStop' : 'batchPartial')}</p>
              <ul>
                {result.object_batch.members.map((m) => (
                  <li key={m.step}>
                    {m.object_id} · {m.step}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {result.choices?.map((choice) => (
            <p key={choice.step}>
              {t('selectedByInput', {
                step: choice.step,
                input: choice.input,
                value: choice.value,
                method: choice.reference.method_id,
                version: choice.reference.version,
              })}
            </p>
          ))}
          {result.subexperts?.length ? (
            <details>
              <summary>{t('nestedExperts')}</summary>
              {result.scope_hours && <p>{t('nestedScope', { hours: result.scope_hours })}</p>}
              <ul>
                {result.subexperts.map((e) => (
                  <li key={e.path.join('/')}>
                    <strong>{e.title}</strong> · {e.path.join(' / ')} · v{e.reference.version}
                    <p className="break-all">
                      {e.reference.method_id} · {e.reference.digest}
                    </p>
                    <p>{t('nestedOutputs', { names: e.outputs.join(', ') })}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <ol className="list-decimal pl-5">
            {result.steps.map((s) => (
              <li key={s.path.join('/')}>
                <strong>{s.title}</strong> · {s.path.join(' / ')} · v{s.reference.version}
                {s.review_phase && <p>{t(s.review_phase)}</p>}
                {s.independent_review_of && (
                  <p>{t('independentReviewOf', { step: s.independent_review_of })}</p>
                )}
                {s.account && <span> · {s.account}</span>}
                {s.quote && ' · ¥' + s.quote.maximum}
                {s.quote?.per_container_second && s.quote.maximum_seconds && (
                  <p>
                    {t('scriptRate', {
                      rate: s.quote.per_container_second,
                      seconds: s.quote.maximum_seconds,
                    })}
                  </p>
                )}
                {s.quote?.provider && (
                  <p>
                    {s.quote.provider} · {s.quote.model} {s.quote.family} · {s.quote.destination}{' '}
                    {s.quote.credential_id}
                    {s.quote.fields?.length ? ' · ' + s.quote.fields.join(', ') : ''}
                  </p>
                )}
                {s.material && (
                  <p className="break-all">
                    {s.material.material_id} · v{s.material.version_no} · SHA-256{' '}
                    {s.material.sha256}
                  </p>
                )}
                {s.permissions.map((p, i) => (
                  <p key={i}>
                    {[p.operations.join(', '), p.purpose, p.destination, p.fields.join(', ')]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ))}
                {Object.entries(s.from_outputs).map(([name, ref]) => (
                  <p key={name}>
                    {t('fromOutput', { name, step: ref.step.join(' / '), output: ref.output })}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          <p>
            {result.estimated_maximum === null
              ? t('unknownPrice')
              : t('priceCeiling', { amount: result.estimated_maximum })}
          </p>
          {result.review_budget && result.review_budget.maximum_with_reworks && (
            <p>
              {t('reviewBudget', {
                count: result.review_budget.max_reworks,
                amount: result.review_budget.maximum_with_reworks,
              })}
            </p>
          )}
          {result.dispatch_gap && result.dispatch_gap !== 'preview_incomplete' && (
            <p>{t(`previewIssues.${result.dispatch_gap}`)}</p>
          )}
          {!result.dispatch_gap && !result.issues.length && (
            <div className="space-y-2">
              {hasEnvelope ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={acceptEnvelope}
                    onChange={(e) => setAcceptEnvelope(e.target.checked)}
                  />
                  {t('acceptEnvelopeConsent')}
                </label>
              ) : null}
              <Button
                type="button"
                disabled={submit.isPending || submit.isSuccess}
                onClick={() => submit.mutate(result.preview_digest)}
              >
                {t('confirmExecution')}
              </Button>
            </div>
          )}
          {result.issues.map((issue, i) => (
            <p key={i}>
              {[
                issue.path.join(' / '),
                issue.slot,
                t.has(`previewIssues.${issue.code}`)
                  ? t(`previewIssues.${issue.code}`)
                  : issue.code,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ))}
        </>
      )}
    </section>
  )
}
