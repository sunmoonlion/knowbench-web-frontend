import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { SwitchAccount } from '@/components/auth/switch-account'
import { leaveTo } from '@/lib/leave-to'
import messages from '@/messages/zh-CN.json'

vi.mock('@/lib/leave-to', () => ({ leaveTo: vi.fn() }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
function setup() {
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <SwitchAccount />
    </NextIntlClientProvider>,
  )
}
it('switches only after a click using the issued CSRF token', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ csrf_token: 's'.repeat(43) }))
    .mockResolvedValueOnce(Response.json({ logout_url: 'https://identity.test/api/logout' }))
  vi.stubGlobal('fetch', fetchImpl)
  setup()
  expect(fetchImpl).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(leaveTo).toHaveBeenCalledWith('https://identity.test/api/logout'))
  expect(fetchImpl).toHaveBeenLastCalledWith(
    '/api/auth/web/switch-account',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 's'.repeat(43) },
    }),
  )
})
it('keeps the page usable when switching fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
  setup()
  fireEvent.click(screen.getByRole('button'))
  await screen.findByRole('alert')
  expect(leaveTo).not.toHaveBeenCalled()
  expect(screen.getByRole('button')).toBeEnabled()
})
