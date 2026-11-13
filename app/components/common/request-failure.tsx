'use client'

import { useTranslations } from 'next-intl'

export function requestFailureKind(error: unknown) {
  const value =
    error && typeof error === 'object' ? (error as { code?: string; status?: number }) : {}
  if (value.status === 401 || value.code === 'auth_required' || value.code === 'session_expired')
    return 'authentication'
  if (value.status === 403) return 'forbidden'
  if (value.status === 404) return 'notFound'
  if (value.code === 'contract_invalid') return 'contract'
  if (value.code === 'capability_reauth_required') return 'capabilityReauth'
  if (value.code === 'capability_unavailable') return 'capability'
  if (value.code === 'stale_state_version') return 'changed'
  return 'unavailable'
}

export function RequestFailure({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useTranslations('requestFailure')
  return (
    <div role="alert" className="text-destructive space-y-2 p-4 text-sm">
      <p>{t(requestFailureKind(error))}</p>
      {retry ? (
        <button type="button" onClick={retry} className="underline">
          {t('retry')}
        </button>
      ) : null}
    </div>
  )
}
