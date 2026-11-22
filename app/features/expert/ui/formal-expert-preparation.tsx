import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import type { FrozenScope } from '../api/formal-expert'
import {
  readPreparation,
  savePreparation,
  type Preparation,
} from '../api/formal-expert-preparation'

type Props = { task: string; fingerprint: string; scope: FrozenScope }

export function ExpertPreparation(props: Props) {
  const t = useTranslations('formalIntake')
  const load = useMutation({ mutationFn: () => readPreparation(props.task), retry: false })
  if (load.data) {
    return (
      <BindingEditor
        key={load.submittedAt}
        {...props}
        initial={load.data}
        reload={() => load.mutate()}
      />
    )
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={load.isPending}
        onClick={() => load.mutate()}
      >
        {t('prepare')}
      </Button>
      {load.isError && <p role="alert">{t('prepLoadError')}</p>}
    </>
  )
}

function BindingEditor({
  task,
  fingerprint,
  scope,
  initial,
  reload,
}: Props & { initial: Preparation; reload: () => void }) {
  const t = useTranslations('formalIntake')
  const { csrfToken } = useWorkbench()
  const [view, setView] = useState(initial)
  const [materials, setMaterials] = useState(initial.bindings.materials)
  const [accounts, setAccounts] = useState(initial.bindings.accounts)
  const [budget, setBudget] = useState(initial.bindings.budget?.limit ?? '')
  const [uncapped, setUncapped] = useState(initial.bindings.budget?.limit === null)
  const shelf = useMutation({ mutationFn: () => readPreparation(task, true), retry: false })
  const save = useMutation({
    mutationFn: () =>
      savePreparation(task, csrfToken, {
        review_digest: fingerprint,
        expected_revision: view.revision,
        materials,
        accounts,
        budget_limit: uncapped ? null : budget,
      }),
    onSuccess: setView,
    retry: false,
  })
  const budgetValid =
    uncapped ||
    (/^\d{1,6}(\.\d{1,2})?$/.test(budget) && Number(budget) > 0 && Number(budget) <= 100000)
  const accountOptions = view.account_options
  return (
    <fieldset className="space-y-3 rounded-lg border p-3" disabled={save.isPending}>
      <legend>{t('prepare')}</legend>
      {scope.inputs.length > 0 && (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={shelf.isPending}
            onClick={() => shelf.mutate()}
          >
            {t('browseMaterials')}
          </Button>
          {shelf.isError && <p role="alert">{t('libraryError')}</p>}
          {scope.inputs.map((slot) => {
            const current = materials[slot.name]
            const choices = shelf.data?.materials ?? []
            const keyOf = (p: Preparation['materials'][number] | typeof current) =>
              [p.material_id, p.version_no, p.sha256].join('/')
            return (
              <label key={slot.name} className="block">
                {t('slotMaterial', { slot: slot.description || slot.name })}
                <select
                  value={current ? keyOf(current) : ''}
                  onChange={(e) => {
                    const choice = choices.find((p) => keyOf(p) === e.target.value)
                    const next = { ...materials }
                    if (choice)
                      next[slot.name] = {
                        material_id: choice.material_id,
                        version_no: choice.version_no,
                        sha256: choice.sha256,
                      }
                    else delete next[slot.name]
                    setMaterials(next)
                  }}
                >
                  <option value="">{t('unbound')}</option>
                  {current && !choices.some((p) => keyOf(p) === keyOf(current)) && (
                    <option value={keyOf(current)}>
                      {view.material_names[current.material_id] ?? current.material_id} · v
                      {current.version_no}
                    </option>
                  )}
                  {choices.map((p) => (
                    <option key={keyOf(p)} value={keyOf(p)}>
                      {p.name} · v{p.version_no} · {p.material_id.slice(-8)}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </>
      )}
      {scope.requirements.map((req) => {
        const options = accountOptions[req.id] ?? []
        const current = accounts[req.id]
        const same = (o: (typeof options)[number]) =>
          o.pin.asset_id === current?.asset_id &&
          o.pin.revision === current?.revision &&
          o.pin.policies_digest === current?.policies_digest
        if (!options.length && !current)
          return <p key={req.id}>{t('noAccount', { requirement: req.id })}</p>
        return (
          <label key={req.id} className="block">
            {t('executionAccount', { requirement: req.id })}
            <select
              value={current ? (options.find(same)?.pin.asset_id ?? 'stale') : ''}
              onChange={(e) => {
                const selected = options.find((o) => o.pin.asset_id === e.target.value)
                const next = { ...accounts }
                if (selected) next[req.id] = selected.pin
                else delete next[req.id]
                setAccounts(next)
              }}
            >
              <option value="">{t('unbound')}</option>
              {current && !options.some(same) && (
                <option value="stale" disabled>
                  {t('staleAccount')}
                </option>
              )}
              {options.map((o) => (
                <option key={o.pin.asset_id} value={o.pin.asset_id}>
                  {[o.name, o.account_label].filter(Boolean).join(' · ')} ·{' '}
                  {o.pin.asset_id.slice(-8)}
                </option>
              ))}
            </select>
          </label>
        )
      })}
      <label className="block">
        {t('rootBudget')}{' '}
        <input
          type="text"
          inputMode="decimal"
          disabled={uncapped}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <label className="block">
        <input type="checkbox" checked={uncapped} onChange={(e) => setUncapped(e.target.checked)} />{' '}
        {t('uncapped')}
      </label>
      {view.invalid_materials.concat(view.invalid_accounts).length > 0 && (
        <p role="alert">
          {t('bindingUnavailable', {
            slots: [...view.invalid_materials, ...view.invalid_accounts].join(', '),
          })}
        </p>
      )}
      <Button type="button" disabled={!budgetValid} onClick={() => save.mutate()}>
        {t('savePreparation')}
      </Button>
      {view.revision > 0 && (
        <p role="status">{t('savedPreparation', { revision: view.revision })}</p>
      )}
      {save.isError && (
        <p role="alert">
          {t('prepSaveError')}{' '}
          <Button type="button" variant="outline" onClick={reload}>
            {t('reloadPreparation')}
          </Button>
        </p>
      )}
    </fieldset>
  )
}
