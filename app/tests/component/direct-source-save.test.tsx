import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { MethodSkillCenterSources } from '@/features/methods/ui/method-skill-center-sources'
import { WorkbenchProvider } from '@/lib/workbench/context'
import * as api from '@/lib/workbench/method-skill-center'
import zh from '@/messages/zh-CN.json'

afterEach(() => vi.restoreAllMocks())

it.each([87381, 87382])(
  'checks UTF-8 limits and retries the submitted source for %i Chinese characters',
  async (size) => {
    vi.spyOn(api, 'listSources').mockResolvedValue([])
    const save = vi.spyOn(api, 'saveSource').mockRejectedValue(new Error('temporarily unavailable'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zh} timeZone="Asia/Shanghai">
        <QueryClientProvider client={client}>
          <WorkbenchProvider csrfToken="fixture" locale="zh-CN">
            <MethodSkillCenterSources />
          </WorkbenchProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    )
    await screen.findByText(zh.directRegistry.empty)
    fireEvent.click(screen.getByRole('button', { name: zh.directRegistry.create }))
    fireEvent.change(screen.getByLabelText(zh.directRegistry.name), { target: { value: '核对' } })
    fireEvent.change(screen.getByLabelText(zh.directRegistry.content), {
      target: { value: '甲'.repeat(size) },
    })
    const submit = screen.getByRole('button', {
      name: zh.directRegistry.save.replace('{version}', '1'),
    })
    if (size === 87382) {
      expect(submit).toBeDisabled()
      fireEvent.click(submit)
      expect(save).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(zh.directRegistry.fileError)
      return
    }
    fireEvent.click(submit)
    const alert = await screen.findByRole('alert')
    expect(save).toHaveBeenCalledTimes(1)
    const [id, version, payload] = save.mock.calls[0]
    expect(payload.content).toHaveLength(size)
    save.mockResolvedValueOnce({
      source_id: id,
      version,
      kind: 'script',
      name: '核对',
      digest: 'fixture',
    })
    fireEvent.click(within(alert).getByRole('button', { name: zh.requestFailure.retry }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0])
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  },
)
