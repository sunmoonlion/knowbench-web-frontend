import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { loadReviewers, reviewerKey, pinKey, saveReviewer } from '@/lib/workbench/reviewer'

export function ReviewerPreference({ csrfToken }: { csrfToken: string }) {
  const t = useTranslations('reviewRouting')
  const cache = useQueryClient()
  const view = useQuery({ queryKey: reviewerKey, queryFn: loadReviewers })
  const [edit, setEdit] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const pin = view.data?.options.find((o) => pinKey(o.pin) === edit)?.pin
      if (edit && !pin) throw new Error('route unavailable')
      return saveReviewer(pin ?? null, csrfToken)
    },
    onSuccess: (data) => {
      cache.setQueryData(reviewerKey, data)
      setEdit(null)
    },
    onError: () => {
      void view.refetch()
    },
  })
  const data = view.data
  const pref = data?.preference
  const selected = edit ?? (pref ? pinKey(pref) : '')
  return (
    <section className="space-y-2 rounded-xl border p-5">
      <h3>{t('preference')}</h3>
      {data && (
        <>
          {data.producer && (
            <p>
              {t('producer')} · {data.producer.provider} / {data.producer.model}
            </p>
          )}
          <label>
            {t('reviewer')}{' '}
            <select
              value={selected}
              disabled={save.isPending}
              onChange={(e) => setEdit(e.target.value)}
            >
              <option value="">{t('automatic')}</option>
              {pref && !data.options.some((o) => pinKey(o.pin) === pinKey(pref)) && (
                <option value={pinKey(pref)} disabled>
                  {pref.provider} / {pref.model} · {t('unavailable')}
                </option>
              )}
              {data.options.map((o) => (
                <option key={pinKey(o.pin)} value={pinKey(o.pin)}>
                  {o.pin.provider} / {o.pin.model} · {o.destination} ·{' '}
                  {o.pin.credential_id.slice(-8)}
                </option>
              ))}
            </select>
          </label>
          {data.gap && <p>{t.has(data.gap) ? t(data.gap) : t('unavailable')}</p>}
          <Button
            type="button"
            disabled={edit === null || save.isPending}
            onClick={() => save.mutate()}
          >
            {t('save')}
          </Button>
          {save.isSuccess && edit === null && <p role="status">{t('saved')}</p>}
        </>
      )}
      {(view.isError || save.isError) && <p role="alert">{t('refresh')}</p>}
    </section>
  )
}
