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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-medium">
              {record.title} · v{record.reference.version} · {t(`status.${record.status}`)}
            </h4>
            {record.status === 'succeeded' && record.outputs !== null ? (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                ✓ {t('v0VerifiedBadge')}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground text-sm">
            {t(
              record.call.detail.execution_kind === 'formal_method_model'
                ? 'modelOrigin'
                : 'manualOrigin',
            )}
          </p>
          <p className="text-sm">{record.detail}</p>
          {record.status === 'unknown' ? <p role="status">{t('unknown')}</p> : null}
          {record.status === 'succeeded' && record.outputs !== null ? (
            <div className="space-y-2">
              <h5 className="text-sm font-medium">{t('validatedOutputs')}</h5>
              <dl className="bg-muted/60 divide-y rounded-lg border p-2 text-xs">
                {Object.entries(record.outputs).map(([slotName, val]) => (
                  <div key={slotName} className="py-1.5 first:pt-0 last:pb-0">
                    <dt className="font-semibold">{slotName}</dt>
                    <dd className="mt-0.5 font-mono whitespace-pre-wrap break-words">
                      {typeof val === 'string' ? val : JSON.stringify(val, null, 2)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          <details className="text-xs">
            <summary className="cursor-pointer">{t('requestDetails')}</summary>
            <p className="mt-1 break-all">
              {record.request_id} · {record.method_call_id}
            </p>
            <p className="break-all">
              {record.reference.method_id} · {record.reference.digest}
            </p>
          </details>
          <h5 className="text-sm font-medium">{t('operation')}</h5>
          <CapabilityActionCard call={record.call} showResult={false} />
        </section>
      ))}
    </section>
  )
}
