'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { getJson, seg, sendJson } from '@/lib/workbench/http'

const option = z.object({
  artifact: z.object({ step_id: z.string(), version: z.number(), digest: z.string() }),
  output_names: z.array(z.string()),
  applicable_promises: z.array(z.string()),
})
const response = z.object({
  report: z
    .object({
      scope_digest: z.string(),
      options: z.array(option),
      missing_steps: z.array(z.string()),
      promises: z.record(z.string(), z.string()),
      received: z.array(z.object({ step: z.string(), outputs: z.record(z.string(), z.json()) })),
    })
    .nullable(),
})

export function PartialDelivery({ task }: { task: string }) {
  const t = useTranslations('formalIntake')
  const { csrfToken } = useWorkbench()
  const path = `/api/workbench/tasks/${seg(task)}/partial-delivery`
  const query = useQuery({
    queryKey: ['ordinary-partial-delivery', task],
    queryFn: () => getJson(response, path),
    retry: false,
  })
  const receive = useMutation({
    mutationFn: (body: { step: string; scope_digest: string }) =>
      sendJson(response, path, { method: 'PUT', csrfToken, body }),
    onSettled: () => query.refetch(),
  })
  const report = query.data?.report
  if (query.isError) return <p role="alert">{t('partialUnavailable')}</p>
  if (!report) return null
  return (
    <section className="space-y-2">
      <h3>{t('partialTitle')}</h3>
      <p>{t('partialMissing', { steps: report.missing_steps.join(', ') })}</p>
      {report.options.map(({ artifact, output_names, applicable_promises }) => {
        const receipt = report.received.find((r) => r.step === artifact.step_id)
        return (
          <div key={artifact.step_id}>
            <p>
              {artifact.step_id} · v{artifact.version} · {output_names.join(', ')}
            </p>
            <p>
              {t('partialPromises', {
                promises:
                  applicable_promises.map((p) => report.promises[p]).join(', ') || t('partialNone'),
              })}
            </p>
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
