'use client'
import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { PlanReview, TemporarySketch } from '../api/formal-expert'

export function TemporaryPlanReview({
  sketch,
  readOnly,
  pending,
  onAdopt,
}: {
  sketch: TemporarySketch
  readOnly: boolean
  pending: boolean
  onAdopt: (review: PlanReview) => void
}) {
  const t = useTranslations('formalIntake')
  const groupId = useId()
  const steps = sketch.selection!.steps
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(steps.map((s) => [s.id, s.task])),
  )
  const [routing, setRouting] = useState<boolean | null>(null)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const branches = steps.filter((s) => Object.keys(s.cases).length)
  const hasRoutes = branches.length > 0
  const cases = Object.fromEntries(
    branches.map((s) => [s.id, [...new Set((labels[s.id] ?? '').split(/\r?\n/).filter(Boolean))]]),
  )
  const matches =
    routing === hasRoutes &&
    branches.every(
      (s) =>
        cases[s.id].length === Object.keys(s.cases).length &&
        Object.keys(s.cases).every((label) => cases[s.id].includes(label)),
    )
  const complete = matches && steps.every((s) => texts[s.id]?.trim())
  const number = (id?: string) => steps.findIndex((s) => s.id === id) + 1
  const title = (alias: string) =>
    [
      sketch.method_titles?.[alias] ?? alias,
      sketch.aliases?.[alias] && 'v' + sketch.aliases[alias].version,
    ]
      .filter(Boolean)
      .join(' · ')
  return (
    <section className="space-y-3" aria-label={t('planSteps')}>
      <h3>{t('planSteps')}</h3>
      {sketch.selection?.object_batch && (
        <p>{t('planBatch', { count: sketch.selection.object_batch.max_objects })}</p>
      )}
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.id}>
            <label className="block">
              {t('planStep', { index: i + 1, method: title(step.method) })}
              {readOnly ? (
                <p>{texts[step.id]}</p>
              ) : (
                <textarea
                  className="block w-full"
                  maxLength={1500}
                  value={texts[step.id]}
                  onChange={(e) => {
                    setTexts({ ...texts, [step.id]: e.target.value })
                    setConfirmed(false)
                  }}
                />
              )}
            </label>
            {Object.entries(step.inputs).map(([input, b]) => (
              <p key={input}>
                {b.step
                  ? t(b.source === 'object_rows' ? 'planRows' : 'planOutput', {
                      input,
                      index: number(b.step),
                      output: b.output ?? '',
                    })
                  : t(b.source === 'object_item' ? 'planObjects' : 'planInput', {
                      input,
                      name: b.name ?? input,
                    })}
              </p>
            ))}
            {!!step.reviews.length && (
              <p>{t('planReviews', { steps: step.reviews.map(number).join(', ') })}</p>
            )}
            {Object.entries(step.cases).map(([label, alias]) => (
              <p key={label}>
                {t('planCase', {
                  input: step.route_input ?? '',
                  value: label,
                  method: title(alias),
                })}
              </p>
            ))}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <>
          {!!sketch.routing_alternatives?.length && (
            <p>{t('planAlternative', { names: sketch.routing_alternatives.join(', ') })}</p>
          )}
          <fieldset>
            <legend>{t('planRouteQuestion')}</legend>
            {[true, false].map((value) => (
              <label key={String(value)} className="mr-3">
                <input
                  type="radio"
                  name={groupId}
                  checked={routing === value}
                  onChange={() => {
                    setRouting(value)
                    setConfirmed(false)
                  }}
                />
                {t(value ? 'planYes' : 'planNo')}
              </label>
            ))}
          </fieldset>
          {routing &&
            branches.map((step) => (
              <label key={step.id} className="block">
                {t('planLabels', { index: number(step.id) })}
                <textarea
                  className="block w-full"
                  value={labels[step.id] ?? ''}
                  onChange={(e) => {
                    setLabels({ ...labels, [step.id]: e.target.value })
                    setConfirmed(false)
                  }}
                />
              </label>
            ))}
          {routing !== null && !matches && <p>{t('planRevise')}</p>}
          <label className="block">
            <input
              type="checkbox"
              disabled={!complete || pending}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t('planConfirm')}
          </label>
          <Button
            disabled={!complete || !confirmed || pending}
            onClick={() =>
              onAdopt({
                confirmed: true,
                routing_required: routing === true,
                cases,
                step_text: texts,
              })
            }
          >
            {t('adoptSketch')}
          </Button>
        </>
      )}
    </section>
  )
}
