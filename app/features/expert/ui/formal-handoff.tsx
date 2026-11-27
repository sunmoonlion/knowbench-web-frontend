'use client'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { HandoffVersions } from './expert-continuity'
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
        attach ? result.htn_tree : undefined,
      ),
    onSuccess: reload,
    retry: false,
  })
  if (result.handoff)
    return (
      <div className="space-y-2">
        <p role="status">{t(result.handoff.mode)}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {result.handoff.studio_method_id && (
            <CrossAppLink
              to="knowlab.studioDraft"
              values={{ method: result.handoff.studio_method_id, version: result.handoff.next_version?.toString() }}
              refValue={task}
              className="font-medium underline"
            >
              {t('openStudioHandoff')}
            </CrossAppLink>
          )}
        </div>
        <HandoffVersions task={task} />
      </div>
    )
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setOpen(true)}>
          {t('toLab')}
        </Button>
        <CrossAppLink
          to="knowmart.demands"
          values={{ title: question.slice(0, 80), problem: question.slice(0, 500) }}
          refValue={task}
          className="text-sm underline"
        >
          {t('postDemandInMarket')}
        </CrossAppLink>
      </div>
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
              {proposal.methods.map((m, step) => (
                <li key={`${step}:${m.method_id}:${m.version}`}>
                  {m.method_id} · v{m.version}
                </li>
              ))}
              <li>{proposal.outputs.join(', ')}</li>
            </ul>
          )}
        </div>
      )}
      <label className="block">
        {t('handoffGap')}
        <textarea
          className="mt-1 w-full rounded border p-2"
          value={gap}
          maxLength={2000}
          disabled={!!result.handoff_gap || submit.isPending}
          onChange={(event) => setGap(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!gap.trim() || submit.isPending} onClick={() => submit.mutate()}>
          {t('sendHandoff')}
        </Button>
        <CrossAppLink
          to="knowmart.demands"
          values={{
            title: question.slice(0, 80),
            problem: `${question}\n${gap}`.slice(0, 500),
          }}
          refValue={task}
          className="text-sm underline"
        >
          {t('postDemandInMarket')}
        </CrossAppLink>
      </div>
      {submit.isError && <p role="alert">{t('handoffRetry')}</p>}
    </section>
  )
}
