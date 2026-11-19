'use client'

import { useQuery } from '@tanstack/react-query'
import { MethodConnectionPreview } from './method-connection-preview'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { RequestFailure } from '@/components/common/request-failure'
import {
  formalMethodCatalog,
  formalReferenceKey,
  type FormalMethodCatalogItem,
} from '@/lib/workbench/formal-methods'

type Reference = FormalMethodCatalogItem['reference']

export function FormalMethodSelection({
  sessionId,
  visible,
  disabled,
  selected,
  onChange,
}: {
  sessionId: string
  visible: boolean
  disabled: boolean
  selected: Reference[]
  onChange: (references: Reference[]) => void
}) {
  const t = useTranslations('formalMethodSelection')
  const catalog = useQuery({
    queryKey: ['formal-method-catalog', sessionId, 'model'],
    queryFn: () => formalMethodCatalog(sessionId, 'model'),
    enabled: visible,
    retry: false,
    refetchOnWindowFocus: true,
  })
  const chosen = new Set(selected.map(formalReferenceKey))
  const missing = selected.filter(
    (reference) =>
      !catalog.data?.some(
        (item) => formalReferenceKey(item.reference) === formalReferenceKey(reference),
      ),
  )
  const remove = (reference: Reference) =>
    onChange(selected.filter((item) => formalReferenceKey(item) !== formalReferenceKey(reference)))
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded border p-3">
      <legend className="px-1 font-medium">{t('title')}</legend>
      <p className="text-muted-foreground">{t('hint')}</p>
      <p className="text-muted-foreground">{t('limit')}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => void catalog.refetch()}>
        {t('refresh')}
      </Button>
      {catalog.isError ? (
        <RequestFailure error={catalog.error} retry={() => void catalog.refetch()} />
      ) : null}
      {!catalog.data && !catalog.isError ? <p>{t('loading')}</p> : null}
      {catalog.data?.length === 0 ? <p>{t('empty')}</p> : null}
      {catalog.data?.map((item) => {
        const key = formalReferenceKey(item.reference)
        return (
          <div key={key} className="space-y-2 rounded border p-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={chosen.has(key)}
                disabled={
                  !chosen.has(key) &&
                  (!item.available ||
                    selected.length >= 20 ||
                    selected.some((ref) => ref.method_id === item.reference.method_id))
                }
                onChange={(event) =>
                  event.target.checked
                    ? onChange([...selected, item.reference])
                    : remove(item.reference)
                }
              />
              <span>
                {item.title} · v{item.reference.version}
              </span>
            </label>
            <p>{item.purpose}</p>
            <MethodConnectionPreview preview={item.connection_preview} />
            {!item.available ? (
              <p role="status">
                {t('unavailable')}
                {item.issue ? ` · ${item.issue}` : ''}
              </p>
            ) : null}
            <details>
              <summary>{t('scope')}</summary>
              <p className="break-all">
                {item.reference.method_id} · v{item.reference.version} · {item.reference.digest}
              </p>
              {item.access_requirements.map((access) => (
                <div key={access.requirement_id} className="mt-2 space-y-1">
                  <p>
                    {access.capability_ref} · {access.version} · {access.operations.join(', ')}
                  </p>
                  {access.resources.map((resource) => (
                    <p key={`${resource.resource_kind}:${resource.resource_role}`}>
                      {resource.resource_role}: {resource.values.join(', ')}
                    </p>
                  ))}
                  <p>
                    {access.data_transfer.destination} ·{' '}
                    {access.data_transfer.argument_fields.join(', ')}
                  </p>
                  <p>{access.data_transfer.purpose}</p>
                </div>
              ))}
              {item.uncovered.map((gap, i) => (
                <p key={i}>
                  {gap.scenario} · {gap.reason} · {gap.scope}
                </p>
              ))}
            </details>
          </div>
        )
      })}
      {missing.map((reference) => (
        <div key={formalReferenceKey(reference)} className="space-y-2 rounded border p-3">
          <p>{t('missing')}</p>
          <p className="break-all">
            {reference.method_id} · v{reference.version} · {reference.digest}
          </p>
          <Button type="button" variant="outline" onClick={() => remove(reference)}>
            {t('remove')}
          </Button>
        </div>
      ))}
    </fieldset>
  )
}
