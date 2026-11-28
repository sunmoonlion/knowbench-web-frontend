'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { adoptVersion, changeDuty, readDuty, readHandoffVersions } from '../api/formal-expert'

function roundLink(task: string) {
  const query = new URLSearchParams(window.location.search)
  query.delete('formal_match')
  query.delete('formalReference')
  query.set('formalMatch', task)
  return '?' + query.toString()
}

export function HandoffVersions({ task }: { task: string }) {
  const t = useTranslations('expertContinuity')
  const { csrfToken } = useWorkbench()
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['handoff-versions', task],
    queryFn: () => readHandoffVersions(task),
    enabled: open,
    retry: false,
  })
  const adopt = useMutation({
    mutationFn: (opt: NonNullable<typeof query.data>['options'][number]) =>
      adoptVersion(task, csrfToken, opt.candidate.reference, opt.review_digest),
    onSuccess: () => query.refetch(),
  })
  return (
    <section>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true)
          if (open) void query.refetch()
        }}
      >
        {t('checkVersions')}
      </Button>
      {open && query.data && (
        <>
          {query.data.options.length === 0 && <p>{t('noVersions')}</p>}
          {query.data.previous && (
            <p>
              {t('priorVersion', { version: query.data.previous.reference.version })} ·{' '}
              {Object.values(query.data.previous.declaration.promises).join(' / ')}
            </p>
          )}
          {query.data.options.map((opt) => (
            <div key={opt.review_digest}>
              <strong>
                {opt.candidate.declaration.title} · v{opt.candidate.reference.version}
              </strong>
              <p>{Object.values(opt.candidate.declaration.promises).join(' / ')}</p>
              <dl>
                {(['applies_when', 'excludes'] as const).map((key) => (
                  <div key={key}>
                    <dt>{t('fields.' + key)}</dt>
                    <dd>{opt.candidate.declaration[key].join(' / ') || '—'}</dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>{t('changes')}</summary>
                <dl>
                  {Object.entries(opt.changes).map(([key, values]) => (
                    <div key={key}>
                      <dt>{t.has('fields.' + key) ? t('fields.' + key) : key}</dt>
                      <dd>
                        <span>{t('before')}</span>{' '}
                        {typeof values.before === 'string'
                          ? values.before
                          : JSON.stringify(values.before)}
                      </dd>
                      <dd>
                        <span>{t('after')}</span>{' '}
                        {typeof values.after === 'string'
                          ? values.after
                          : JSON.stringify(values.after)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
              <code className="break-all">{opt.candidate.reference.digest}</code>
              {!query.data.adopted.some(
                (a) =>
                  a.reference.digest === opt.candidate.reference.digest &&
                  a.reference.version === opt.candidate.reference.version &&
                  a.reference.method_id === opt.candidate.reference.method_id,
              ) && (
                <Button disabled={adopt.isPending} onClick={() => adopt.mutate(opt)}>
                  {t('adopt')}
                </Button>
              )}
            </div>
          ))}
          {query.data.adopted.map((a) => (
            <p key={a.task_id}>
              <a className="underline" href={roundLink(a.task_id)}>
                {t('openVersion', { version: a.reference.version })}
              </a>
            </p>
          ))}
        </>
      )}
      {(query.isError || adopt.isError) && <p role="alert">{t('unavailable')}</p>}
    </section>
  )
}

export function ExpertDuty({
  origin,
  task,
  execution,
  outputs,
  slots,
  question,
}: {
  origin: string
  task: string
  execution?: string
  slots: string[]
  outputs: string[]
  question: string
}) {
  const t = useTranslations('expertContinuity')
  const { csrfToken } = useWorkbench()
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState(question)
  const [hours, setHours] = useState('24')
  const [field, setField] = useState(outputs[0] ?? '')
  const [slot, setSlot] = useState('')
  const query = useQuery({
    queryKey: ['expert-duty', origin],
    queryFn: () => readDuty(origin),
    enabled: open,
    retry: false,
  })
  const save = useMutation({
    mutationFn: ({
      action,
      body,
    }: {
      action: '' | '/state' | '/output' | '/withdrawal'
      body: Record<string, unknown>
    }) => changeDuty(origin, action, csrfToken, body),
    onSuccess: () => query.refetch(),
  })
  const d = query.data
  return (
    <section>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true)
          if (open) void query.refetch()
        }}
      >
        {t('duty')}
      </Button>
      {open && d === null && execution && (
        <div className="grid gap-2">
          <label>
            {t('instruction')}
            <textarea
              value={instruction}
              maxLength={1967}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>
          <label>
            {t('hours')}
            <input type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label>
            {t('field')}
            <select value={field} onChange={(e) => setField(e.target.value)}>
              {outputs.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          {slots.length > 0 && (
            <label>
              {t('slot')}
              <select value={slot} onChange={(e) => setSlot(e.target.value)}>
                <option value="">{t('referenceOnly')}</option>
                {slots.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
          {slot && <p>{t('convert')}</p>}
          <p>{t('terms')}</p>
          <Button
            disabled={
              save.isPending ||
              !instruction.trim() ||
              !field ||
              !Number.isSafeInteger(Number(hours)) ||
              Number(hours) < 1
            }
            onClick={() =>
              save.mutate({
                action: '',
                body: {
                  instruction: instruction.trim(),
                  interval_hours: Number(hours),
                  output: field,
                  material_slot: slot.trim() || null,
                },
              })
            }
          >
            {t('create')}
          </Button>
        </div>
      )}
      {open && d && (
        <div className="space-y-2">
          <p>
            {d.config.instruction} · v{d.config.reference.version} ·{' '}
            {t('cadence', { hours: d.config.interval_hours })}
          </p>
          <p>
            {d.paused ? t('paused') : t('next', { when: new Date(d.next_at).toLocaleString() })}
          </p>
          {d.problem && <p role="alert">{t('blocked', { reason: d.problem })}</p>}
          <Button
            variant="outline"
            disabled={save.isPending}
            onClick={() => save.mutate({ action: '/state', body: { paused: !d.paused } })}
          >
            {t(d.paused ? 'resume' : 'pause')}
          </Button>
          {d.current_match !== task && (
            <a className="underline" href={roundLink(d.current_match)}>
              {t('current')}
            </a>
          )}
          {d.approved && (
            <div>
              <p>{t('released', { name: d.config.output })}</p>
              <Button
                variant="outline"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    action: '/withdrawal',
                    body: { execution_id: d.approved!.execution },
                  })
                }
              >
                {t('withdraw')}
              </Button>
            </div>
          )}
          {!d.paused &&
            !d.approved &&
            d.current_match === task &&
            execution &&
            outputs.includes(d.config.output) && (
              <Button
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({ action: '/output', body: { execution_id: execution } })
                }
              >
                {t('release', { name: d.config.output })}
              </Button>
            )}
        </div>
      )}
      {(query.isError || save.isError) && <p role="alert">{t('unavailable')}</p>}
    </section>
  )
}
