'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { RequestFailure } from '@/components/common/request-failure'
import { useWorkbench } from '@/lib/workbench/context'
import * as api from '@/lib/workbench/capabilities'

export function CapabilityActionCard({
  call,
  showResult = true,
}: {
  call: api.CapabilityCall
  showResult?: boolean
}) {
  const renderResult = showResult && call.detail.execution_kind !== 'formal_method'
  const scriptResult =
    call.detail.execution_kind === 'skill_script'
      ? api.scriptResultSchema.safeParse(call.detail.result)
      : null
  const t = useTranslations('capabilities'),
    { csrfToken } = useWorkbench(),
    client = useQueryClient()
  const decision = useMutation({
    mutationFn: (answer: 'accept' | 'decline') => api.decide(call, answer, csrfToken),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['capability-calls', call.session_id] }),
        client.invalidateQueries({ queryKey: ['formal-method-invocations', call.session_id] }),
      ])
    },
  })
  const stop = useMutation({
    mutationFn: () => api.cancelScript(call.id, csrfToken),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['capability-calls', call.session_id] }),
        client.invalidateQueries({ queryKey: ['formal-method-invocations', call.session_id] }),
      ])
    },
  })
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <h4 className="font-medium">
        {call.detail.tool.name} ·{' '}
        {t.has(`state.${call.status}`) ? t(`state.${call.status}`) : call.status}
      </h4>
      {['formal_mcp', 'formal_method'].includes(call.detail.execution_kind ?? '') ? (
        <p>{t('formalMethodCall')}</p>
      ) : null}
      {call.detail.execution_kind === 'formal_probe' ? <p>{t('formalModelProbeCall')}</p> : null}
      <p>
        {call.detail.connection_name} · {call.detail.account_label}
      </p>
      {call.detail.purpose ? (
        <p>
          {t('purpose')}：{call.detail.purpose}
        </p>
      ) : null}
      <p>{t('actionHint')}</p>
      <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
        {JSON.stringify(call.detail.arguments, null, 2)}
      </pre>
      {call.status === 'awaiting_approval' ? (
        <div className="flex gap-2">
          <Button disabled={decision.isPending} onClick={() => decision.mutate('accept')}>
            {t('allowOnce')}
          </Button>
          <Button
            variant="outline"
            disabled={decision.isPending}
            onClick={() => decision.mutate('decline')}
          >
            {t('decline')}
          </Button>
        </div>
      ) : null}
      {call.status === 'dispatching' && call.detail.execution_kind === 'skill_script' ? (
        <div className="space-y-2">
          <p role="status">{t('scriptRunning')}</p>
          <Button variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {t('stopScript')}
          </Button>
        </div>
      ) : call.status === 'unknown' || call.status === 'dispatching' ? (
        <p role="status">{t('unknownOutcome')}</p>
      ) : null}
      {renderResult && scriptResult?.success ? (
        <div className="space-y-2 text-sm">
          <p>{t('scriptExit', { code: scriptResult.data.exit_code ?? '—' })}</p>
          {scriptResult.data.timed_out ? <p role="status">{t('scriptTimeout')}</p> : null}
          {scriptResult.data.output_truncated ? <p>{t('scriptTruncated')}</p> : null}
          {scriptResult.data.stdout ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
              {scriptResult.data.stdout}
            </pre>
          ) : null}
          {scriptResult.data.stderr ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
              {scriptResult.data.stderr}
            </pre>
          ) : null}
          {scriptResult.data.artifact_error ? <p>{scriptResult.data.artifact_error}</p> : null}
          {scriptResult.data.artifacts.map((artifact, index) => (
            <a
              key={index}
              className="block break-all underline"
              href={`/api/workbench/capability-calls/${call.id}/artifacts/${index}`}
              download
            >
              {t('downloadArtifact', { name: artifact.path })}
            </a>
          ))}
        </div>
      ) : renderResult && call.detail.result !== undefined ? (
        <details>
          <summary>{t('result')}</summary>
          <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap">
            {JSON.stringify(call.detail.result, null, 2)}
          </pre>
        </details>
      ) : null}
      {decision.isError ? (
        <RequestFailure
          error={decision.error}
          retry={() =>
            void client.invalidateQueries({ queryKey: ['capability-calls', call.session_id] })
          }
        />
      ) : null}
      {stop.isError ? <RequestFailure error={stop.error} retry={() => stop.mutate()} /> : null}
    </section>
  )
}
