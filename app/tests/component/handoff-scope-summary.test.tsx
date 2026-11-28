import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { expect, it, vi } from 'vitest'
import { HandoffVersions } from '@/features/expert/ui/expert-continuity'
import { WorkbenchProvider } from '@/lib/workbench/context'
import zh from '@/messages/zh-CN.json'

it('labels applicable and excluded conditions even when the condition did not change', async () => {
  const task = '11111111-1111-4111-8111-111111111111'
  const reference = { method_id: task, version: 2, digest: 'sha256:' + 'a'.repeat(64) }
  async function display(excludes: boolean) {
    const scope = ['年报核验']
    const declaration = {
      title: '财务核验',
      promises: { result: '核验表' },
      applies_when: excludes ? [] : scope,
      excludes: excludes ? scope : [],
    }
    const candidateBefore = {
      reference: { ...reference, version: 1 },
      declaration: { ...declaration, title: '旧版' },
      promise_outputs: {},
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          previous: candidateBefore,
          adopted: [],
          options: [
            {
              candidate: { reference, declaration, promise_outputs: {} },
              review_digest: 'v',
              changes: { title: { before: '旧版', after: '财务核验' } },
            },
          ],
        }),
      ),
    )
    const client = new QueryClient()
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zh} timeZone="Asia/Shanghai">
        <QueryClientProvider client={client}>
          <WorkbenchProvider csrfToken="fixture" locale="zh-CN">
            <HandoffVersions task={task} />
          </WorkbenchProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: zh.expertContinuity.checkVersions }))
    const scopeLine = await screen.findByText('年报核验')
    const shown = scopeLine.previousElementSibling?.textContent
    cleanup()
    client.clear()
    return shown
  }
  try {
    expect(await display(true)).toBe(zh.expertContinuity.fields.excludes)
    expect(await display(false)).toBe(zh.expertContinuity.fields.applies_when)
  } finally {
    vi.unstubAllGlobals()
  }
})
