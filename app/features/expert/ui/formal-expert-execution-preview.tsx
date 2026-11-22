import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { readExecutionPreview, submitExecution } from '../api/formal-expert-preparation'

export function ExecutionPreview({
  task,
  revision,
  onConfirmed,
}: {
  task: string
  revision: number
  onConfirmed: () => void
}) {
  const t = useTranslations('formalIntake')
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
    mutationFn: (fingerprint: string) => submitExecution(task, revision, fingerprint, csrfToken),
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
                    {s.quote.provider} · {s.quote.model} · {s.quote.destination}
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
          {result.dispatch_gap && result.dispatch_gap !== 'preview_incomplete' && (
            <p>{t(`previewIssues.${result.dispatch_gap}`)}</p>
          )}
          {!result.dispatch_gap && !result.issues.length && (
            <Button
              type="button"
              disabled={submit.isPending || submit.isSuccess}
              onClick={() => submit.mutate(result.preview_digest)}
            >
              {t('confirmExecution')}
            </Button>
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
