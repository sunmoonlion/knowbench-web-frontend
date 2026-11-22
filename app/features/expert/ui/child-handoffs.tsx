'use client'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import {
  closeHandoffs,
  readHandoffs,
  readHandoffEvidence,
  type HandoffParent,
  type HandoffCommand,
} from '../api/handoffs'

function Evidence({
  task,
  child,
  artifact,
}: {
  task: string
  child: string
  artifact: { id: string; name: string; version: number; digest: string }
}) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('formalIntake')
  const data = useQuery({
    queryKey: ['child-handoff-evidence', task, child, artifact.id],
    queryFn: () => readHandoffEvidence(task, child, artifact.id),
    enabled: open,
    retry: false,
  })
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="break-all">
        {artifact.name} · v{artifact.version} · {artifact.digest}
      </summary>
      {data.data && (
        <pre className="whitespace-pre-wrap">{JSON.stringify(data.data.outputs, null, 2)}</pre>
      )}
      {data.isError && <p role="alert">{t('handoffError')}</p>}
    </details>
  )
}

function Parent({
  task,
  parent,
  onChange,
}: {
  task: string
  parent: HandoffParent
  onChange: () => void
}) {
  const t = useTranslations('formalIntake')
  const { csrfToken } = useWorkbench()
  const save = useMutation({
    mutationFn: (body: HandoffCommand) => closeHandoffs(task, csrfToken, body),
    onSettled: onChange,
  })
  return (
    <form
      className="space-y-2 border-t py-2"
      onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        save.mutate({
          parent_call_id: parent.parent_call_id,
          scope_digest: parent.scope_digest,
          residual: String(form.get('residual') ?? '').trim() || null,
          decisions: parent.children.map((c) => ({
            child_call_id: c.child_call_id,
            evidence_digest: c.evidence_digest,
            decision: form.get(c.child_call_id) as HandoffCommand['decisions'][number]['decision'],
            reason: String(form.get(c.child_call_id + '-reason') ?? '').trim(),
            next_owner: String(form.get(c.child_call_id + '-owner') ?? '').trim() || null,
          })),
        })
      }}
    >
      {parent.children.map((c) => {
        const saved = parent.closure?.command.decisions.find(
          (d) => d.child_call_id === c.child_call_id,
        )
        return (
          <fieldset key={c.child_call_id} className="space-y-1">
            <legend>
              {c.rounds[0]?.request.role.join(' / ')} · {c.state}
            </legend>
            {c.rounds.map((r) => (
              <details key={r.request.attempt_id ?? c.child_call_id}>
                <summary>
                  {r.request.goal} · v{r.request.reference.version}
                </summary>
                <p className="break-all">
                  {t('handoffInput')} {r.request.input_digest}
                </p>
                {r.receipts.map((s, i) => (
                  <div key={i}>
                    {s.state} {s.failure} {Object.values(s.executor).join(' · ')} {s.cost}
                    {s.artifacts.map((a) => (
                      <Evidence key={a.id} task={task} child={c.child_call_id} artifact={a} />
                    ))}
                  </div>
                ))}
                {r.late.map((l) => (
                  <p key={l.operation_call_id}>
                    {t('handoffLate')} {l.status} · {l.operation_call_id}
                  </p>
                ))}
              </details>
            ))}
            {saved && (
              <p>
                {t(saved.decision)} · {saved.reason} {saved.next_owner}
              </p>
            )}
            {parent.can_close && (
              <>
                <select
                  required
                  aria-label={t('handoffDecision')}
                  name={c.child_call_id}
                  defaultValue=""
                >
                  <option value="">{t('handoffDecision')}</option>
                  {c.state === 'COMPLETED' && <option value="accept">{t('accept')}</option>}
                  <option value="decline">{t('decline')}</option>
                  <option value="defer">{t('defer')}</option>
                </select>
                <label>
                  {t('handoffReason')}{' '}
                  <input required maxLength={2000} name={c.child_call_id + '-reason'} />
                </label>
                <label>
                  {t('handoffNext')} <input maxLength={200} name={c.child_call_id + '-owner'} />
                </label>
              </>
            )}
          </fieldset>
        )
      })}
      {parent.missing.length > 0 && (
        <p>
          {t('partialMissing', {
            steps: parent.missing.map((path) => path.join(' / ')).join(', '),
          })}
        </p>
      )}
      {parent.closure && (
        <p>
          {t('handoffClosed')} {parent.closure.closed_at} {parent.closure.command.residual}
        </p>
      )}
      {parent.can_close && (
        <>
          {parent.missing.length > 0 && (
            <label>
              {t('handoffResidual')} <input name="residual" required maxLength={2000} />
            </label>
          )}
          <Button type="submit" disabled={save.isPending}>
            {t('handoffClose')}
          </Button>
        </>
      )}
      {save.isError && <p role="alert">{t('handoffError')}</p>}
    </form>
  )
}

export function ChildHandoffs({ task }: { task: string }) {
  const t = useTranslations('formalIntake')
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['expert-child-handoffs', task],
    queryFn: () => readHandoffs(task),
    enabled: open,
  })
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('handoffTitle')}</summary>
      {query.isError && <p role="alert">{t('handoffError')}</p>}
      {query.data?.parents.length === 0 && <p>{t('handoffEmpty')}</p>}
      {query.data?.parents.map((p) => (
        <Parent
          key={p.parent_call_id + p.scope_digest}
          task={task}
          parent={p}
          onChange={() => void query.refetch()}
        />
      ))}
      {open && (
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          {t('handoffRefresh')}
        </Button>
      )}
    </details>
  )
}
