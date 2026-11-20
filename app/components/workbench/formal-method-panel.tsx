'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { RequestFailure } from '@/components/common/request-failure'
import { formalMethodInvocations } from '@/lib/workbench/formal-methods'
import { CapabilityActionCard } from './capability-action-card'

export function FormalMethodPanel({ sessionId, visible }: { sessionId: string; visible: boolean }) {
  const t = useTranslations('formalMethods')
  const history = useQuery({
    queryKey: ['formal-method-invocations', sessionId, 'list'],
    queryFn: () => formalMethodInvocations(sessionId),
    enabled: visible,
    retry: false,
    refetchInterval: visible ? 3000 : false,
    refetchIntervalInBackground: false,
  })
  const records = history.data ?? []
  if (!records.length && !history.isError) return null
  return (
    <section className="space-y-3 rounded border p-4">
      <h3 className="font-medium">{t('history')}</h3>
      {history.isError && (
        <RequestFailure error={history.error} retry={() => void history.refetch()} />
      )}
      {records.map((record) => (
        <section
          key={record.request_id}
          className="space-y-3 rounded border p-3"
          aria-label={`${record.title} · ${t(`status.${record.status}`)}`}
        >
          <h4 className="font-medium">
            {record.title} · v{record.reference.version} · {t(`status.${record.status}`)}
          </h4>
          <p>
            {t(
              record.call.detail.execution_kind === 'formal_method_model'
                ? 'modelOrigin'
                : 'manualOrigin',
            )}
          </p>
          <p>{record.detail}</p>
          {record.status === 'unknown' ? <p role="status">{t('unknown')}</p> : null}
          {record.status === 'succeeded' && record.outputs !== null ? (
            <div>
              <h5 className="font-medium">{t('validatedOutputs')}</h5>
              <pre className="bg-muted max-h-72 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                {JSON.stringify(record.outputs, null, 2)}
              </pre>
            </div>
          ) : null}
          <details>
            <summary>{t('requestDetails')}</summary>
            <p className="break-all">
              {record.request_id} · {record.method_call_id}
            </p>
            <p className="break-all">
              {record.reference.method_id} · {record.reference.digest}
            </p>
          </details>
          <h5>{t('operation')}</h5>
          <CapabilityActionCard call={record.call} showResult={false} />
        </section>
      ))}
    </section>
  )
}
