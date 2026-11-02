'use client'

import { useRecoveredSession } from '@/components/auth/session-boundary'
import { createContext, useContext } from 'react'

// 登录的是谁：侧栏底部显示，免得换了测试账号还以为是自己（所有者 2026-10-17）
export type SignedInUser = { name: string; email: string | null }

type WorkbenchContext = { csrfToken: string; locale: string; user?: SignedInUser }

const Context = createContext<WorkbenchContext | null>(null)

// 进了工作台之后各功能都要用的：改动类请求的 CSRF、当前语言、登录的是谁
export function WorkbenchProvider({
  csrfToken,
  locale,
  user,
  children,
}: WorkbenchContext & { children: React.ReactNode }) {
  const recovered = useRecoveredSession()
  const currentUser = recovered
    ? {
        name: recovered.user.display_name || recovered.user.email || recovered.user.actor_id,
        email: recovered.user.email ?? null,
      }
    : user
  return (
    <Context.Provider
      value={{ csrfToken: recovered?.csrf_token ?? csrfToken, locale, user: currentUser }}
    >
      {children}
    </Context.Provider>
  )
}

export function useWorkbench() {
  const value = useContext(Context)
  if (value === null) throw new Error('useWorkbench must be used inside WorkbenchProvider')
  return value
}
