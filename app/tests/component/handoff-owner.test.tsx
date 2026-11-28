import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { ChildHandoffs } from '@/features/expert/ui/child-handoffs'
import { WorkbenchProvider } from '@/lib/workbench/context'
import * as api from '@/features/expert/api/handoffs'
import messages from '@/messages/zh-CN.json'

afterEach(() => vi.restoreAllMocks())
it('requires a nonblank next owner on deferred or declined decisions and displays pending settlement', async () => {
  const id = '61023ed4-24b5-414e-928f-43074ddf28b6'
  const request = {
    role: ['review'],
    goal: '核验',
    attempt_id: id,
    reference: { method_id: id, version: 1, digest: 'v1' },
    input_digest: 'input',
    inputs: [],
  }
  vi.spyOn(api, 'readHandoffs').mockResolvedValue({
    parents: [
      {
        parent_call_id: id,
        scope_digest: 'scope',
        can_close: true,
        missing: [],
        closure: null,
        children: [
          {
            child_call_id: id,
            evidence_digest: 'd',
            state: 'COMPLETED',
            rounds: [
              {
                request,
                late: [],
                receipts: [
                  {
                    state: 'COMPLETED',
                    artifacts: [],
                    failure: null,
                    executor: {},
                    cost: null,
                    cost_pending: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <QueryClientProvider client={new QueryClient()}>
        <WorkbenchProvider csrfToken="fixture" locale="zh-CN">
          <ChildHandoffs task={id} />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
  fireEvent.click(screen.getByText(messages.formalIntake.handoffTitle))
  const decision = await screen.findByRole('combobox')
  const owner = screen.getByLabelText(messages.formalIntake.handoffNext) as HTMLInputElement
  for (const value of ['defer', 'decline']) {
    fireEvent.change(decision, { target: { value } })
    expect(owner).toBeRequired()
    for (const name of ['', '   ']) {
      fireEvent.change(owner, { target: { value: name } })
      expect(owner.checkValidity()).toBe(false)
    }
    fireEvent.change(owner, { target: { value: '作者' } })
    expect(owner.checkValidity()).toBe(true)
  }
  fireEvent.change(decision, { target: { value: 'accept' } })
  fireEvent.change(owner, { target: { value: '' } })
  expect(owner.checkValidity()).toBe(true)
  expect(screen.getByText(messages.formalIntake.handoffCostPending)).toBeInTheDocument()
})
