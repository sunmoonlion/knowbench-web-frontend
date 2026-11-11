import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LoginPage from '@/app/[locale]/(auth)/login/page'
import { getBrowserSession } from '@/lib/server/auth-session'
import { redirect } from 'next/navigation'

vi.mock('@/components/auth/switch-account', () => ({
  SwitchAccount: () => <button>switch-account</button>,
}))
vi.mock('@/lib/server/auth-session', () => ({ getBrowserSession: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))

function login(query: Record<string, string> = {}, locale = 'zh-CN') {
  return LoginPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(query) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBrowserSession).mockResolvedValue(null)
})

describe('automatic web SSO entry', () => {
  it.each(['zh-CN', 'en'])(
    'starts authentication without rendering a local form (%s)',
    async (locale) => {
      const target = `/${locale}/applications/new?from=knowbench&ref=expert`
      await expect(login({ next: target }, locale)).rejects.toThrow(
        `redirect:/api/auth/web/login?return_to=${encodeURIComponent(target)}`,
      )
    },
  )

  it('uses the dashboard when no destination was provided', async () => {
    await expect(login()).rejects.toThrow(
      'redirect:/api/auth/web/login?return_to=%2Fzh-CN%2Fdashboard',
    )
  })

  it.each(['https://other.test/path', '//other.test/path', '/zh-CN/login', '/en/dashboard'])(
    'rejects unsafe or recursive destinations: %s',
    async (next) => {
      await expect(login({ next })).rejects.toThrow(
        'redirect:/api/auth/web/login?return_to=%2Fzh-CN%2Fdashboard',
      )
    },
  )

  it('returns an existing local session directly to the requested page', async () => {
    vi.mocked(getBrowserSession).mockResolvedValue(
      {} as NonNullable<Awaited<ReturnType<typeof getBrowserSession>>>,
    )
    await expect(login({ next: '/zh-CN/applications/new' })).rejects.toThrow(
      'redirect:/zh-CN/applications/new',
    )
    expect(redirect).toHaveBeenCalledTimes(1)
  })

  it('shows callback errors and a manual retry instead of automatically looping', async () => {
    render(await login({ error: 'auth_failed', reason: 'provider_unavailable' }))
    expect(redirect).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('errorIdentityUnavailable')
    expect(screen.getByRole('link', { name: 'login' })).toHaveAttribute(
      'href',
      '/api/auth/web/login?return_to=%2Fzh-CN%2Fdashboard',
    )
  })

  it.each(['1', 'true'])('preserves the registration confirmation (%s)', async (registered) => {
    render(await login({ registered }))
    expect(redirect).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('signupSuccessHint')
  })

  it('does not retry authentication when the session backend is unavailable', async () => {
    vi.mocked(getBrowserSession).mockRejectedValue(new Error('backend_unavailable'))
    await expect(login()).rejects.toThrow('backend_unavailable')
    expect(redirect).not.toHaveBeenCalled()
  })
})

it.each([
  ['organization_not_allowed', 'errorAccountOrganization'],
  ['oidc_transaction_invalid', 'errorLoginTransaction'],
  ['token_invalid', 'errorIdentityRejected'],
  ['login_required', 'errorLoginRequired'],
  ['authorization_denied', 'errorOAuthGeneric'],
  ['unexpected', 'errorAuthFailed'],
])('shows the actual callback failure (%s)', async (reason, expected) => {
  render(await login({ error: 'auth_failed', reason }))
  expect(screen.getByRole('alert')).toHaveTextContent(expected)
  expect(redirect).not.toHaveBeenCalled()
})
