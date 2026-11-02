'use client'

import { useRecoveredSession } from '@/components/auth/session-boundary'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { leaveTo } from '@/lib/leave-to'

type LogoutButtonProps = {
  csrfToken: string
  locale: string
  label: string
  errorLabel: string
}

export function LogoutButton({ csrfToken, locale, label, errorLabel }: LogoutButtonProps) {
  const router = useRouter()
  const recovered = useRecoveredSession()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function logout() {
    setPending(true)
    setFailed(false)
    try {
      const response = await fetch('/api/auth/web/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': recovered?.csrf_token ?? csrfToken,
        },
      })
      if (!response.ok) throw new Error('logout_failed')
      // 200 带 logout_url：去身份提供方结束单点登录会话，它再跳回本应用（SDD 0027）；204 只做了本地退出
      const body: unknown = response.status === 200 ? await response.json() : null
      const logoutUrl =
        body && typeof body === 'object' && 'logout_url' in body ? body.logout_url : null
      if (typeof logoutUrl === 'string' && logoutUrl.startsWith('https://')) {
        leaveTo(logoutUrl)
        return
      }
      router.replace(`/${locale}/login`)
      router.refresh()
    } catch {
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {failed ? (
        <span className="text-destructive text-sm" role="alert">
          {errorLabel}
        </span>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={logout}
        className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  )
}
