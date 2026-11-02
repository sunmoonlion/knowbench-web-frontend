'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'

import { browserSessionSchema, type BrowserSession } from '@/contracts/auth'
import { loginPath, nextPath } from '@/lib/auth/next-path'
import { sessionRecovery } from '@/lib/auth/session-recovery'
import { leaveTo } from '@/lib/leave-to'

const RecoveredSession = createContext<BrowserSession | null>(null)
export const useRecoveredSession = () => useContext(RecoveredSession)

// Keep the protected subtree mounted (but hidden/inert) so drafts stay only in
// memory. Reauthentication uses another tab, never local/session storage.
export function SessionBoundary({
  session,
  locale,
  children,
}: {
  session: BrowserSession
  locale: string
  children: React.ReactNode
}) {
  const t = useTranslations('sessionRecovery')
  const client = useQueryClient()
  const expired = useSyncExternalStore(
    sessionRecovery.subscribe,
    sessionRecovery.snapshot,
    () => false,
  )
  const [recovered, setRecovered] = useState<BrowserSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [changedAccount, setChangedAccount] = useState(false)
  const [returnTo, setReturnTo] = useState(`/${locale}/dashboard`)

  useEffect(() => {
    if (!expired) return
    setReturnTo(
      nextPath(
        locale,
        window.location.pathname + window.location.search + window.location.hash,
        `/${locale}/dashboard`,
      ),
    )
    void client.cancelQueries()
  }, [expired, client, locale])

  async function resume() {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      // Explicit read-only check bypasses the expired-session request gate.
      const response = await fetch('/api/auth/web/me', {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'manual',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('session_check_failed')
      const current = browserSessionSchema.parse(await response.json())
      if (
        current.user.app !== session.user.app ||
        current.user.actor_id !== session.user.actor_id
      ) {
        setChangedAccount(true)
        return
      }
      if (Date.parse(current.user.expires_at) <= Date.now()) throw new Error('expired')
      setRecovered(current)
      // Publish the fresh CSRF context before refetching. Failed mutations are
      // never resumed: only GET queries reset, after the next React commit.
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // Clear after the old account's observers have unmounted. Clearing while
    // they are mounted lets an in-flight render recreate their cache entries.
    if (changedAccount) client.clear()
  }, [changedAccount, client])

  useEffect(() => {
    if (!recovered) return
    sessionRecovery.recover()
    void client.resetQueries()
  }, [recovered, client])

  return (
    <RecoveredSession.Provider value={recovered}>
      <div
        style={{ display: expired ? 'none' : 'contents' }}
        hidden={expired}
        inert={expired || undefined}
        aria-hidden={expired || undefined}
      >
        {changedAccount ? null : children}
      </div>
      {expired ? (
        <section
          className="bg-background fixed inset-0 z-50 flex items-center justify-center p-6"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-recovery-title"
        >
          <div className="max-w-lg space-y-4 rounded-xl border p-6 shadow-sm">
            <h1 id="session-recovery-title" className="text-lg font-semibold">
              {t(changedAccount ? 'accountChanged' : 'title')}
            </h1>
            <p>{t(changedAccount ? 'accountChangedHint' : 'hint')}</p>
            {changedAccount ? (
              <button type="button" onClick={() => leaveTo(returnTo)} className="underline">
                {t('reopen')}
              </button>
            ) : (
              <div className="flex flex-wrap gap-4">
                <a
                  href={loginPath(locale, returnTo)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {t('login')}
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resume()}
                  className="underline disabled:opacity-50"
                >
                  {t(busy ? 'checking' : 'resume')}
                </button>
              </div>
            )}
            {failed ? <p role="alert">{t('failed')}</p> : null}
          </div>
        </section>
      ) : null}
    </RecoveredSession.Provider>
  )
}
