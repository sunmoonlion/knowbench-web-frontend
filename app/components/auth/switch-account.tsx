'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { leaveTo } from '@/lib/leave-to'

export function SwitchAccount() {
  const t = useTranslations('auth')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function switchAccount() {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const options = {
        credentials: 'same-origin' as const,
        cache: 'no-store' as const,
        redirect: 'error' as const,
        signal: AbortSignal.timeout(10_000),
      }
      const preparation = await fetch('/api/auth/web/switch-account', options)
      if (!preparation.ok) throw new Error('switch_unavailable')
      const { csrf_token } = await preparation.json()
      if (typeof csrf_token !== 'string') throw new Error('switch_invalid')
      const response = await fetch('/api/auth/web/switch-account', {
        ...options,
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf_token },
      })
      if (!response.ok) throw new Error('switch_failed')
      const { logout_url } = await response.json()
      const url = new URL(logout_url)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('switch_invalid')
      leaveTo(url.href)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 text-center text-sm">
      <button
        type="button"
        className="underline disabled:opacity-50"
        disabled={busy}
        onClick={() => void switchAccount()}
      >
        {t(busy ? 'switchAccountBusy' : 'switchAccount')}
      </button>
      <p className="text-muted-foreground text-xs">{t('switchAccountHint')}</p>
      {failed ? <p role="alert">{t('switchAccountFailed')}</p> : null}
    </div>
  )
}
