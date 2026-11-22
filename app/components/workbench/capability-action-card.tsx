'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNow, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { RequestFailure } from '@/components/common/request-failure'
import { useWorkbench } from '@/lib/workbench/context'
import * as api from '@/lib/workbench/capabilities'

/** Work and expert approval surfaces share the same receipt as the session panel. */
export function PendingConnectorAction({
  sessionId,
  callId,
}: {
  sessionId: string
  callId: string
}) {
  const t = useTranslations('capabilities')
  const calls = useQuery({
    queryKey: ['capability-calls', sessionId, callId],
    queryFn: () => api.calls(sessionId, callId),
    refetchInterval: 5000,
  })
  if (calls.isError)
    return <RequestFailure error={calls.error} retry={() => void calls.refetch()} />
  const call = calls.data?.calls.find((entry) => entry.id === callId)
  return call ? (
    <CapabilityActionCard call={call} />
  ) : (
    <p role="status">{t(calls.isPending ? 'loadingApproval' : 'missingApproval')}</p>
  )
}

export function CapabilityActionCard({
  call,
  showResult = true,
}: {
  call: api.CapabilityCall
  showResult?: boolean
}) {
  const isScript = ['skill_script', 'formal_script'].includes(call.detail.execution_kind ?? '')
  const running = isScript && call.status === 'dispatching'
  const result = call.detail.result
  const stopping =
    running &&
    typeof result === 'object' &&
    result !== null &&
    'stop_requested' in result &&
    result.stop_requested === true
  const renderResult =
    showResult &&
    !running &&
    !['formal_method', 'formal_method_model'].includes(call.detail.execution_kind ?? '')
  const scriptResult = isScript ? api.scriptResultSchema.safeParse(call.detail.result) : null
  const t = useTranslations('capabilities'),
    { csrfToken, locale } = useWorkbench(),
    client = useQueryClient()
  const materialHash =
    call.detail.execution_kind === 'formal_function' ? call.detail.material_sha256 : undefined
  const decision = useMutation({
    mutationFn: async (answer: 'accept' | 'decline' | 'read_scope' | 'revoke_read') => {
      if (answer === 'revoke_read')
        return api.revokeReadApproval(call.detail.approval?.origin ?? call.id, csrfToken)
      if (materialHash && answer === 'accept')
        await api.consentMaterialRead(call, materialHash, csrfToken)
      return api.decide(
        call,
        answer === 'read_scope' ? 'accept' : answer,
        csrfToken,
        answer === 'read_scope',
      )
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['capability-calls', call.session_id] }),
        client.invalidateQueries({ queryKey: ['formal-method-invocations', call.session_id] }),
      ])
    },
  })
  const now = useNow({ updateInterval: 30_000 })
  const approval = call.detail.approval
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
        {call.detail.execution_kind === 'formal_method_model'
          ? `${call.detail.method_title} · v${call.detail.reference.version}`
          : call.detail.tool.name}{' '}
        · {t.has(`state.${call.status}`) ? t(`state.${call.status}`) : call.status}
      </h4>
      {[
        'formal_mcp',
        'formal_method',
        'formal_script',
        'formal_function',
        'formal_instruction',
      ].includes(call.detail.execution_kind ?? '') ? (
        <p>{t('formalMethodCall')}</p>
      ) : null}
      {call.detail.execution_kind === 'formal_method_model' ? (
        <div className="space-y-1">
          <p>{t('formalModelMethodCall')}</p>
          <p>{t('formalMethodOperation', { tool: call.detail.tool.name })}</p>
          <details>
            <summary>{t('formalMethodReference')}</summary>
            <p className="break-all">
              {call.detail.reference.method_id} · v{call.detail.reference.version} ·{' '}
              {call.detail.reference.digest}
            </p>
            <p>
              {t('formalMethodSource', {
                name: call.detail.connection_name,
                revision: call.detail.revision,
              })}
            </p>
            <p className="break-all">{call.detail.source_asset_id}</p>
          </details>
        </div>
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
      {call.detail.execution_kind === 'formal_instruction' && (
        <p>{t('instructionQuote', call.detail.instruction_quote)}</p>
      )}
      {'registered_source' in call.detail &&
        call.detail.registered_source.kind.startsWith('registered_') && (
          <p className="break-all">
            {call.detail.registered_source.entry} · v{call.detail.registered_source.version} ·{' '}
            {call.detail.registered_source.digest}
          </p>
        )}
      {call.detail.execution_kind === 'formal_script' ? (
        <p>
          {t('scriptQuote', {
            environment: call.detail.script_quote.environment,
            rate: call.detail.script_quote.per_container_second,
            currency: call.detail.script_quote.currency,
            maximum: call.detail.script_quote.maximum,
          })}
        </p>
      ) : null}
      {approval ? (
        <div className="space-y-1 text-sm break-all">
          <p>
            {t('actionTarget', {
              effect: t(`actionEffect.${approval.effect}`),
              name: approval.operation,
              destination: approval.destination,
              revision: call.detail.revision,
            })}
          </p>
          <p>{t(approval.verified_zero_cost ? 'zeroActionCost' : 'unknownActionCost')}</p>
          {approval.resources.map((resource) => (
            <p key={resource.resource_role}>
              {resource.resource_role} · {resource.values.join(', ')}
            </p>
          ))}
          {approval.attachments.map((file, index) => (
            <p key={index}>
              {file.name} · {file.size} B · SHA-256 {file.sha256}
            </p>
          ))}
          {approval.read_until && (
            <p>{t('readTerms', { date: new Date(approval.read_until).toLocaleString(locale) })}</p>
          )}
          {approval.origin && <p>{t('readOrigin', { id: approval.origin })}</p>}
          {approval.revoked && <p role="status">{t('readRevoked')}</p>}
          {(approval.granted || approval.origin) &&
            !approval.revoked &&
            approval.read_until &&
            Date.parse(approval.read_until) > now.getTime() && (
              <Button
                variant="outline"
                disabled={decision.isPending}
                onClick={() => decision.mutate('revoke_read')}
              >
                {t('revokeRead')}
              </Button>
            )}
        </div>
      ) : null}
      {materialHash && <p className="break-all">SHA-256 {materialHash}</p>}
      {call.status === 'awaiting_approval' && <p>{t('actionHint')}</p>}
      <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
        {JSON.stringify(call.detail.arguments, null, 2)}
      </pre>
      {call.status === 'awaiting_approval' ? (
        <div className="flex gap-2">
          <Button disabled={decision.isPending} onClick={() => decision.mutate('accept')}>
            {t(materialHash ? 'allowMaterialRead' : 'allowOnce')}
          </Button>
          {!materialHash && approval?.read_until && (
            <Button
              variant="outline"
              disabled={decision.isPending || Date.parse(approval.read_until) <= now.getTime()}
              onClick={() => decision.mutate('read_scope')}
            >
              {t('allowReadScope')}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={decision.isPending}
            onClick={() => decision.mutate('decline')}
          >
            {t('decline')}
          </Button>
        </div>
      ) : null}
      {running ? (
        <div className="space-y-2">
          <p role="status">{t(stopping ? 'scriptStopping' : 'scriptRunning')}</p>
          <Button
            variant="outline"
            disabled={stopping || stop.isPending}
            onClick={() => stop.mutate()}
          >
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
