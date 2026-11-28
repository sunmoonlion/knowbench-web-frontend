'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { readPartial, receivePartial } from '../api/formal-expert'

export function PartialDelivery({ task }: { task: string }) {
  const t = useTranslations('formalIntake')
  const { csrfToken } = useWorkbench()
  const query = useQuery({
    queryKey: ['ordinary-partial-delivery', task],
    queryFn: () => readPartial(task),
    retry: false,
  })
  const receive = useMutation({
    mutationFn: (body: { step: string; scope_digest: string }) =>
      receivePartial(task, csrfToken, body),
    onSettled: () => query.refetch(),
  })
  const report = query.data?.report
  if (query.isError) return <p role="alert">{t('partialUnavailable')}</p>
  if (!report) return null
  return (
    <section className="space-y-2">
      <h3>{t('partialTitle')}</h3>
      <p>{t('partialMissing', { steps: report.missing_steps.join(', ') })}</p>
      {report.missing_objects?.length ? (
        <p>{t('partialObjects', { objects: report.missing_objects.join(', ') })}</p>
      ) : null}
      {report.options.map(({ artifact, output_names, applicable_promises, conditional_promises, object_id }) => {
        const receipt = report.received.find((r) => r.step === artifact.step_id)
        return (
          <div key={artifact.step_id}>
            <p>
              {object_id ?? artifact.step_id} · v{artifact.version} · {output_names.join(', ')}
            </p>
            <p>
              {t('partialPromises', {
                promises:
                  applicable_promises.map((p) => report.promises[p]).join(', ') || t('partialNone'),
              })}
            </p>
            {Object.entries(conditional_promises ?? {}).map(([id, condition]) =>
              <p key={id}>{t('partialConditional', {promise:report.promises[id], condition:condition.when, slots:condition.input_slots.join(', ') || t('partialNone')})}</p>
            )}
            {receipt ? (
              <pre className="whitespace-pre-wrap">{JSON.stringify(receipt.outputs, null, 2)}</pre>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={receive.isPending}
                onClick={() =>
                  receive.mutate({ step: artifact.step_id, scope_digest: report.scope_digest })
                }
              >
                {t('partialReceive', { step: artifact.step_id })}
              </Button>
            )}
          </div>
        )
      })}
      {receive.isError && <p role="alert">{t('partialUnavailable')}</p>}
    </section>
  )
}
