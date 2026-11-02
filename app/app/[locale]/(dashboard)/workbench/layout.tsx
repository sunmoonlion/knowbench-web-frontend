import { SessionBoundary } from '@/components/auth/session-boundary'
import { WorkbenchShell } from '@/features/shell'
import { requireBrowserSession } from '@/lib/server/auth-session'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// 工作台的框架：侧栏在左，各页在右。进来先要登录。
export default async function WorkbenchLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await requireBrowserSession(locale)
  return (
    <SessionBoundary session={session} locale={locale}>
      <WorkbenchShell
        csrfToken={session.csrf_token}
        locale={locale}
        user={{
          name: session.user.display_name || session.user.email || session.user.actor_id,
          email: session.user.email ?? null,
        }}
      >
        {children}
      </WorkbenchShell>
    </SessionBoundary>
  )
}
