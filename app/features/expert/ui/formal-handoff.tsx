'use client'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CrossAppLink } from '@/components/common/cross-app-link'
import { useWorkbench } from '@/lib/workbench/context'
import { sendHandoff, type Feedback } from '../api/formal-expert'

export function FormalHandoff({
  task,
  question,
  result,
  initialGap = '',
  reload,
}: {
  task: string
  question: string
  result: Feedback
  initialGap?: string
  reload: () => Promise<unknown>
}) {
  const t = useTranslations('formalIntake')
  const { csrfToken } = useWorkbench()
  const [open, setOpen] = useState(Boolean(result.handoff_gap))
  const [gap, setGap] = useState(result.handoff_gap ?? initialGap)
  const [attach, setAttach] = useState(!!result.attached_plan)
  const proposal = result.suggested_plan
  const ref = result.handoff_reference ?? null
  const submit = useMutation({
    mutationFn: () =>
      sendHandoff(
        task,
        csrfToken,
        result.review_digest,
        gap.trim(),
        ref,
        attach ? proposal?.sketch_digest : undefined,
      ),
    onSuccess: reload,
    retry: false,
  })
  if (result.handoff)
    return (
      <div>
        <p role="status">{t(result.handoff.mode)}</p>
        <CrossAppLink
          to="knowlab.application"
          values={{ item: result.handoff.request_id }}
          refValue={task}
          fallback={<span>{result.handoff.request_id}</span>}
          className="underline"
        >
          {t('openHandoff')}
        </CrossAppLink>
      </div>
    )
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('toLab')}
      </Button>
    )
  return (
    <section aria-label={t('toLab')} className="space-y-2">
      <p>{t('handoffPreview')}</p>
      <p>{question}</p>
      {ref && <p>{t('handoffMethod', { id: ref.method_id, version: ref.version })}</p>}
      {proposal && (
        <div>
          <label>
            <input
              type="checkbox"
              checked={attach}
              disabled={!!result.handoff_gap}
              onChange={(e) => setAttach(e.target.checked)}
            />
            {t('attachPlan')}
          </label>
          {attach && (
            <ul>
              {proposal.methods.map((m) => (
                <li key={m.method_id}>
                  {m.method_id} · v{m.version}
                </li>
              ))}
              <li>{proposal.outputs.join(', ')}</li>
            </ul>
          )}
        </div>
      )}
      <label>
        {t('handoffGap')}
        <textarea
          value={gap}
          maxLength={2000}
          disabled={!!result.handoff_gap || submit.isPending}
          onChange={(event) => setGap(event.target.value)}
        />
      </label>
      <Button disabled={!gap.trim() || submit.isPending} onClick={() => submit.mutate()}>
        {t('sendHandoff')}
      </Button>
      {submit.isError && <p role="alert">{t('handoffRetry')}</p>}
    </section>
  )
}
