'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RequestFailure } from '@/components/common/request-failure'
import { useWorkbench } from '@/lib/workbench/context'
import { WorkbenchError } from '@/lib/workbench/http'
import * as api from '@/lib/workbench/formal-methods'
import { CapabilityActionCard } from './capability-action-card'

const input = 'mt-1 w-full rounded border bg-background p-2 text-sm'
const terminal = (value: api.FormalMethodInvocation | undefined) =>
  !!value && !['awaiting_approval', 'dispatching'].includes(value.status)
const invocationKey = (sessionId: string, requestId?: string) => [
  'formal-method-invocations',
  sessionId,
  'request',
  requestId,
]

export function FormalMethodPanel({ sessionId, visible }: { sessionId: string; visible: boolean }) {
  const t = useTranslations('formalMethods')
  const permission = useTranslations('capabilities')
  const { csrfToken } = useWorkbench()
  const cache = useQueryClient()
  const [choice, setChoice] = useState('')
  const [values, setValues] = useState('{}')
  const [invalid, setInvalid] = useState(false)
  const [submitted, setSubmitted] = useState<api.FormalMethodInvoke | null>(null)
  const catalog = useQuery({
    queryKey: ['formal-method-catalog', sessionId],
    queryFn: () => api.formalMethodCatalog(sessionId),
    enabled: visible,
    retry: false,
    refetchOnWindowFocus: true,
  })
  const history = useQuery({
    queryKey: ['formal-method-invocations', sessionId, 'list'],
    queryFn: () => api.formalMethodInvocations(sessionId),
    enabled: visible,
    retry: false,
    refetchInterval: visible ? 3000 : false,
    refetchIntervalInBackground: false,
  })
  const invoke = useMutation({
    mutationFn: (command: api.FormalMethodInvoke) =>
      api.invokeFormalMethod(sessionId, command, csrfToken),
    retry: false,
    onSuccess: async (result, command) => {
      cache.setQueryData(invocationKey(sessionId, command.request_id), result)
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['formal-method-invocations', sessionId] }),
        cache.invalidateQueries({ queryKey: ['capability-calls', sessionId] }),
      ])
    },
  })
  const lookup = useQuery({
    queryKey: invocationKey(sessionId, submitted?.request_id),
    queryFn: () => api.formalMethodInvocation(sessionId, submitted!),
    enabled: visible && !!submitted && !invoke.isPending,
    retry: false,
    refetchInterval: (query) => (visible && !terminal(query.state.data) ? 3000 : false),
  })
  const recovered = history.data?.find(
    (item) =>
      item.request_id === submitted?.request_id &&
      api.formalReferenceKey(item.reference) === api.formalReferenceKey(submitted.reference),
  )
  const current =
    recovered && history.dataUpdatedAt >= lookup.dataUpdatedAt
      ? recovered
      : (lookup.data ?? recovered)
  const selected = catalog.data?.find((item) => api.formalReferenceKey(item.reference) === choice)
  const records = [...(history.data ?? [])]
  if (current) {
    const at = records.findIndex((record) => record.request_id === current.request_id)
    if (at < 0) records.unshift(current)
    else records[at] = current
  }
  const rejected =
    invoke.error instanceof WorkbenchError && [400, 403, 422].includes(invoke.error.status ?? 0)
  const start = () => {
    if (!selected?.available || submitted || invoke.isPending) return
    try {
      const parsed = api.formalMethodValuesSchema.parse(JSON.parse(values))
      if (
        Object.entries(selected.inputs).some(
          ([name, slot]) => slot.required && !Object.hasOwn(parsed, name),
        )
      )
        throw new Error('missing required input')
      const command = {
        request_id: crypto.randomUUID(),
        reference: selected.reference,
        values: parsed,
      }
      setInvalid(false)
      setSubmitted(command)
      invoke.mutate(command)
    } catch {
      setInvalid(true)
    }
  }
  const reset = () => {
    setSubmitted(null)
    setInvalid(false)
    invoke.reset()
  }
  const refresh = () => {
    void catalog.refetch()
    void history.refetch()
    if (submitted) void lookup.refetch()
  }
  return (
    <section className="space-y-3 rounded border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{t('title')}</h3>
        <Button size="sm" variant="outline" onClick={refresh}>
          {t('refresh')}
        </Button>
      </div>
      <p className="text-muted-foreground">{t('hint')}</p>
      <p className="text-muted-foreground">{t('costHint')}</p>
      {catalog.isError ? (
        <RequestFailure error={catalog.error} retry={() => void catalog.refetch()} />
      ) : null}
      {catalog.data?.length === 0 ? <p>{t('empty')}</p> : null}
      {!catalog.data && !catalog.isError ? <p>{t('loading')}</p> : null}
      {!submitted ? (
        <fieldset disabled={invoke.isPending} className="space-y-3">
          <label className="block">
            {t('choose')}
            <select
              className={input}
              value={choice}
              onChange={(event) => {
                setChoice(event.target.value)
                setValues('{}')
                setInvalid(false)
              }}
            >
              <option value="">{t('choosePlaceholder')}</option>
              {catalog.data?.map((item) => (
                <option
                  key={api.formalReferenceKey(item.reference)}
                  value={api.formalReferenceKey(item.reference)}
                >
                  {item.title} · v{item.reference.version}
                  {item.available ? '' : ` · ${t('unavailable')}`}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <>
              <p>{selected.purpose}</p>
              {!selected.available ? (
                <p role="status">
                  {t('unavailable')}
                  {selected.issue ? `：${selected.issue}` : ''}
                </p>
              ) : null}
              <details>
                <summary>{t('reference')}</summary>
                <p className="break-all">
                  {selected.reference.method_id} · {selected.reference.version} ·{' '}
                  {selected.reference.digest}
                </p>
              </details>
              <h4 className="font-medium">{t('inputs')}</h4>
              {Object.entries(selected.inputs).map(([name, slot]) => (
                <details key={name}>
                  <summary>
                    {name} · {slot.description} · {t(slot.required ? 'required' : 'optional')}
                  </summary>
                  <pre className="max-h-48 overflow-auto text-xs">
                    {JSON.stringify(slot.schema, null, 2)}
                  </pre>
                </details>
              ))}
              {!Object.keys(selected.inputs).length ? <p>{t('noInputs')}</p> : null}
              <h4 className="font-medium">{t('outputs')}</h4>
              {Object.entries(selected.outputs).map(([name, slot]) => (
                <details key={name}>
                  <summary>
                    {name} · {slot.description}
                  </summary>
                  <pre className="max-h-48 overflow-auto text-xs">
                    {JSON.stringify(slot.schema, null, 2)}
                  </pre>
                </details>
              ))}
              {selected.access_requirements.length ? (
                <div className="space-y-2">
                  <h4 className="font-medium">{t('permissions')}</h4>
                  {selected.access_requirements.map((requirement) => (
                    <div key={requirement.requirement_id} className="rounded border p-2">
                      <p>
                        {requirement.capability_ref} · {requirement.version}
                      </p>
                      <p>
                        {permission('methodPermissionOperation', {
                          capability: requirement.capability_ref,
                          version: requirement.version,
                          operations: requirement.operations.join(', '),
                        })}
                      </p>
                      {requirement.resources.map((resource) => (
                        <p key={resource.resource_role}>
                          {resource.resource_role}: {resource.values.join(', ')}
                        </p>
                      ))}
                      <p>
                        {requirement.data_transfer.destination} ·{' '}
                        {requirement.data_transfer.argument_fields.join(', ')}
                      </p>
                      <p>{requirement.data_transfer.purpose}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {selected.uncovered.length ? (
                <div className="rounded border p-2">
                  <h4 className="font-medium">{t('uncovered')}</h4>
                  {selected.uncovered.map((gap, index) => (
                    <p key={index}>
                      {gap.scenario} · {gap.reason} · {gap.scope}
                    </p>
                  ))}
                </div>
              ) : null}
              <label className="block">
                {t('values')}
                <textarea
                  className={input}
                  rows={6}
                  value={values}
                  onChange={(event) => {
                    setValues(event.target.value)
                    setInvalid(false)
                  }}
                />
              </label>
              <p className="text-muted-foreground">{t('inputHint')}</p>
            </>
          ) : choice ? (
            <p role="status">{t('selectionChanged')}</p>
          ) : null}
          {invalid ? <p role="alert">{t('invalid')}</p> : null}
          <Button
            disabled={!selected?.available || catalog.isFetching || catalog.isError}
            onClick={start}
          >
            {t('invoke')}
          </Button>
        </fieldset>
      ) : (
        <div className="space-y-2">
          <p>
            {t('request')}: {submitted.request_id}
          </p>
          {invoke.isPending ? <p role="status">{t('submitting')}</p> : null}
          {!current && !invoke.isPending ? <p>{t('uncertain')}</p> : null}
          {!current && invoke.isError ? <RequestFailure error={invoke.error} /> : null}
          {!current && lookup.isError ? <RequestFailure error={lookup.error} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={invoke.isPending || lookup.isFetching}
              onClick={() => void lookup.refetch()}
            >
              {t('check')}
            </Button>
            {!current && invoke.isError ? (
              <Button disabled={invoke.isPending} onClick={() => invoke.mutate(submitted)}>
                {t('retrySame')}
              </Button>
            ) : null}
            {terminal(current) || (!current && rejected) ? (
              <Button variant="outline" disabled={invoke.isPending} onClick={reset}>
                {t(current ? 'prepareAnother' : 'editRejected')}
              </Button>
            ) : null}
          </div>
          {current?.status === 'unknown' ? <p role="status">{t('unknown')}</p> : null}
        </div>
      )}
      {history.isError ? (
        <RequestFailure error={history.error} retry={() => void history.refetch()} />
      ) : null}
      {records.length ? <h4 className="font-medium">{t('history')}</h4> : null}
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
