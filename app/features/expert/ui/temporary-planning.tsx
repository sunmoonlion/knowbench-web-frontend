'use client'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { TemporaryPlanReview } from './temporary-plan-review'
import { ScopePreview } from './formal-expert-scope'
import { ExpertPreparation } from './formal-expert-preparation'
import {
  type PlanReview,
  readSketch,
  adoptSketch,
  requestSketch,
  saveSketch,
  listProbeMaterials,
  checkPlanningColumn,
} from '../api/formal-expert'

export function TemporaryPlanning({
  task,
  digest,
  reload,
}: {
  task: string
  digest: string
  reload: () => Promise<unknown>
}) {
  const t = useTranslations('formalIntake')
  const { csrfToken } = useWorkbench()
  const [details, setDetails] = useState('')
  const [focus, setFocus] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [sheet, setSheet] = useState('')
  const [column, setColumn] = useState('')
  const [source, setSource] = useState('')
  const [reuse, setReuse] = useState(false)
  const plan = useQuery({
    queryKey: ['temporary-plan', task],
    queryFn: () => readSketch(task),
    retry: false,
    refetchInterval: (q) => (q.state.data?.outcome === 'planning' ? 1500 : false),
  })
  const materials = useMutation({
    mutationFn: () => listProbeMaterials(task, digest),
    retry: false,
  })
  const material = materials.data?.materials.find((m) => m.material_id === materialId)
  const probe = useMutation({
    mutationFn: () =>
      checkPlanningColumn(
        task,
        csrfToken,
        digest,
        plan.data!.planning_task!,
        material!,
        sheet,
        column,
      ),
    onSuccess: () => plan.refetch(),
    retry: false,
  })
  const query = useMutation({
    mutationFn: () =>
      requestSketch(
        task,
        csrfToken,
        digest,
        focus && details.trim() ? `[${focus}] ${details}` : details,
        plan.data?.planning_task,
        plan.data?.probe?.consent,
      ),
    onSuccess: () => plan.refetch(),
    retry: false,
  })
  const sourcePreview = useMutation({ mutationFn: () => readSketch(source.trim()), retry: false })
  const current = reuse ? sourcePreview.data : plan.data
  const accept = useMutation({
    mutationFn: (review?: PlanReview) =>
      adoptSketch(
        task,
        csrfToken,
        digest,
        current!.sketch_digest!,
        reuse ? source.trim() : undefined,
        review,
      ),
    onSuccess: async () => {
      setReuse(false)
      await plan.refetch()
    },
    retry: false,
  })
  const save = useMutation({
    mutationFn: () => saveSketch(task, csrfToken, plan.data!.sketch_digest!),
    onSuccess: async () => {
      await plan.refetch()
      await reload()
    },
    retry: false,
  })
  if (plan.isLoading) return null
  const adopted = plan.data?.outcome === 'adopted'
  return (
    <section aria-label={t('sketchTitle')} className="space-y-3">
      {plan.data?.outcome === 'idle' && (
        <>
          <Button disabled={query.isPending} onClick={() => query.mutate()}>
            {t('sketchTitle')}
          </Button>
          <p>{t('sketchBudget')}</p>
          <Button variant="outline" onClick={() => setReuse(!reuse)}>
            {t('reusePlan')}
          </Button>
        </>
      )}
      {reuse && (
        <div>
          <label>
            {t('savedPlanId')}
            <input
              value={source}
              onChange={(e) => {
                setSource(e.target.value)
                sourcePreview.reset()
              }}
            />
          </label>
          <Button
            disabled={!source.trim() || sourcePreview.isPending}
            onClick={() => sourcePreview.mutate()}
          >
            {t('previewSaved')}
          </Button>
        </div>
      )}
      {current?.selection?.tree && (
        <section>
          <h3>{t('treeTitle')}</h3>
          <ul>
            {current.selection.tree.nodes.map((n) => (
              <li key={n.id} style={{ marginInlineStart: (n.id.split('_').length - 1) * 16 }}>
                {n.goal} · {t('nodeState.' + n.status)}
                {n.operator && ' · ' + t('operator.' + n.operator)}
                {n.reason && <p>{n.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {plan.data?.outcome === 'planning' && <p role="status">{t('planning')}</p>}
      {['clarify', 'gap'].includes(plan.data?.outcome ?? '') && (
        <>
          <p>
            {plan.data?.explanation &&
            /^selection_[a-z_]+$/.test(plan.data.explanation) &&
            t.has('graphErrors.' + plan.data.explanation)
              ? t('graphErrors.' + plan.data.explanation)
              : plan.data?.explanation || t('missingPlan')}
          </p>
          {plan.data?.outcome === 'clarify' && !plan.data.probe && (
            <div className="space-y-2">
              <Button variant="outline" onClick={() => materials.mutate()}>
                {t('chooseProbe')}
              </Button>
              {materials.data && (
                <>
                  <label>
                    {t('probeMaterial')}
                    <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
                      <option value="" />
                      {materials.data.materials.map((m) => (
                        <option key={m.material_id} value={m.material_id}>
                          {m.name} · v{m.version_no}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('probeSheet')}
                    <input value={sheet} onChange={(e) => setSheet(e.target.value)} />
                  </label>
                  <label>
                    {t('probeColumn')}
                    <input value={column} onChange={(e) => setColumn(e.target.value)} />
                  </label>
                  <Button
                    disabled={!material || !column.trim() || probe.isPending}
                    onClick={() => probe.mutate()}
                  >
                    {t('approveProbe')}
                  </Button>
                </>
              )}
            </div>
          )}
          {plan.data?.probe && (
            <p>
              {t('probeResult', {
                sheet: plan.data.probe.result.sheet,
                column: plan.data.probe.result.column,
                status: t(plan.data.probe.result.status),
              })}
            </p>
          )}
          {plan.data?.search_goal && <p>{plan.data.search_goal}</p>}
        </>
      )}
      {plan.data?.planning_task &&
        ['plan', 'gap', 'clarify'].includes(plan.data.outcome) &&
        !reuse &&
        (plan.data.remaining_rounds ?? 0) > 0 && (
          <>
            {plan.data.selection?.tree && (
              <label>
                {t('focus')}{' '}
                <select value={focus} onChange={(e) => setFocus(e.target.value)}>
                  <option value="">{t('whole')}</option>
                  {plan.data.selection.tree.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.goal}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {t('clarifyPlan')}
              <textarea
                value={details}
                maxLength={focus ? 1497 - focus.length : 1500}
                onChange={(e) => setDetails(e.target.value)}
              />
            </label>
            <Button
              disabled={
                (!details.trim() && !plan.data?.probe && !plan.data?.search_goal) || query.isPending
              }
              onClick={() => query.mutate()}
            >
              {t('replan')}
            </Button>
          </>
        )}
      {current?.runtime && (
        <details>
          <summary>{t('runtimePatterns')}</summary>
          <ul>
            {Object.entries(current.runtime.patterns).map(([key, enabled]) => (
              <li key={key}>
                {t.has('patterns.' + key) ? t('patterns.' + key) : key} ·{' '}
                {t(enabled ? 'availablePattern' : 'unavailablePattern')}
              </li>
            ))}
          </ul>
          {!!current.missing?.length && (
            <p>{t('missingCapability', { names: current.missing.join(', ') })}</p>
          )}
        </details>
      )}
      {current?.scope && <ScopePreview scope={current.scope} />}
      {current?.explanation && current.outcome === 'plan' && <p>{current.explanation}</p>}
      {current?.partial && <p>{t('partial')}</p>}
      {current?.selection && current.sketch_digest && (
        <TemporaryPlanReview
          key={[task, reuse ? source : '', current.sketch_digest, current.outcome].join('/')}
          sketch={current}
          readOnly={adopted || (reuse && !current.saved)}
          pending={accept.isPending}
          onAdopt={(review) => accept.mutate(review)}
        />
      )}
      {!current?.selection && !adopted && current?.sketch_digest && (!reuse || current.saved) && (
        <Button disabled={accept.isPending} onClick={() => accept.mutate(undefined)}>
          {t('adoptSketch')}
        </Button>
      )}
      {adopted && plan.data?.scope && (
        <>
          {plan.data.saved ? (
            <p>
              {t('savedPlanId')} {task}
            </p>
          ) : (
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
              {t('savePlan')}
            </Button>
          )}
          <ExpertPreparation
            task={task}
            fingerprint={digest}
            scope={plan.data.scope}
            onConfirmed={() => void reload()}
          />
        </>
      )}
      {(probe.isError ||
        materials.isError ||
        query.isError ||
        accept.isError ||
        save.isError ||
        plan.isError ||
        sourcePreview.isError) && <p role="alert">{t('unavailable')}</p>}
    </section>
  )
}
