'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type {
  DelegationOption,
  ResourceAuthorityRef,
  Selection,
} from '@/lib/workbench/capabilities'

type References = Record<string, ResourceAuthorityRef>
export const authorityReferenceKey = (ref: ResourceAuthorityRef) =>
  JSON.stringify([ref.record_id, ref.revision, ref.digest])
export function delegationSelectionValid(
  options: DelegationOption[],
  selected: References,
  tools: string[],
  now = Date.now(),
) {
  return Object.entries(selected).every(
    ([tool, ref]) =>
      tools.includes(tool) &&
      options.some(
        (option) =>
          option.tool_key === tool &&
          authorityReferenceKey(option.authority) === authorityReferenceKey(ref) &&
          Date.parse(option.expires_at) > now,
      ),
  )
}

export function ResourceDelegationSelection({
  options,
  selected,
  tools,
  availableTools,
  disabled,
  onChange,
}: {
  options: DelegationOption[]
  selected: References
  tools: string[]
  availableTools: Selection['available_tools']
  disabled: boolean
  onChange: (next: References) => void
}) {
  const t = useTranslations('resourceDelegation')
  const keys = [...new Set([...options.map((option) => option.tool_key), ...Object.keys(selected)])]
  const clear = (tool: string) => {
    const next = { ...selected }
    delete next[tool]
    onChange(next)
  }
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded border p-3">
      <legend className="px-1 font-medium">{t('title')}</legend>
      <p className="text-muted-foreground">{t('hint')}</p>
      <p className="text-muted-foreground">{t('defaultHint')}</p>
      {keys.map((tool) => {
        const asset = availableTools.find((item) => item.key === tool)
        const choices = options.filter((option) => option.tool_key === tool)
        const ref = selected[tool]
        const chosen = ref
          ? choices.find(
              (option) => authorityReferenceKey(option.authority) === authorityReferenceKey(ref),
            )
          : undefined
        const valid = !ref || delegationSelectionValid(options, { [tool]: ref }, tools)
        return (
          <div key={tool} className="space-y-2 rounded border p-3">
            <label className="block">
              {t('choose', { tool: asset ? `${asset.connection_name} · ${asset.name}` : tool })}
              <select
                className="mt-1 w-full rounded border p-2"
                value={ref ? authorityReferenceKey(ref) : ''}
                disabled={!tools.includes(tool)}
                onChange={(event) => {
                  const option = choices.find(
                    (item) =>
                      authorityReferenceKey(item.authority) === event.target.value &&
                      Date.parse(item.expires_at) > Date.now(),
                  )
                  if (option) onChange({ ...selected, [tool]: option.authority })
                  else if (!event.target.value) clear(tool)
                }}
              >
                <option value="">{t('none')}</option>
                {ref && !chosen ? (
                  <option value={authorityReferenceKey(ref)} disabled>
                    {t('stale')}
                  </option>
                ) : null}
                {choices.map((option) => (
                  <option
                    key={authorityReferenceKey(option.authority)}
                    value={authorityReferenceKey(option.authority)}
                    disabled={Date.parse(option.expires_at) <= Date.now()}
                  >
                    {option.issuer} · {option.authority.record_id} · r{option.authority.revision}
                  </option>
                ))}
              </select>
            </label>
            {!tools.includes(tool) ? <p>{t('selectTool')}</p> : null}
            {ref ? (
              <>
                {!valid ? <p role="alert">{t('stale')}</p> : null}
                <details>
                  <summary>{t('reference')}</summary>
                  <p className="break-all">
                    {ref.record_id} · r{ref.revision} · {ref.digest}
                  </p>
                  {chosen ? (
                    <>
                      <p>{t('issuer', { issuer: chosen.issuer })}</p>
                      <p>{t('expiry', { value: chosen.expires_at })}</p>
                      <p>
                        {t('binding', {
                          parent: chosen.binding.parent_method_id,
                          child: chosen.binding.child_method_id,
                          version: chosen.binding.child_method_version,
                        })}
                      </p>
                      <p className="break-all">{chosen.binding.parent_snapshot_digest}</p>
                    </>
                  ) : null}
                </details>
                <Button type="button" variant="outline" onClick={() => clear(tool)}>
                  {t('clear')}
                </Button>
              </>
            ) : null}
          </div>
        )
      })}
    </fieldset>
  )
}
