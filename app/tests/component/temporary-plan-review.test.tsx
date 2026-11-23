import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { expect, it, vi } from 'vitest'
import { TemporaryPlanReview } from '@/features/expert/ui/temporary-plan-review'
import messages from '@/messages/zh-CN.json'

it('requires an independent routing decision, each label and confirmation of the final text', () => {
  const onAdopt = vi.fn()
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="UTC">
      <TemporaryPlanReview
        readOnly={false}
        pending={false}
        onAdopt={onAdopt}
        sketch={{
          outcome: 'plan',
          selection: {
            object_batch: null,
            steps: [
              {
                id: 'dispatch',
                method: 'a',
                task: '分派单据',
                route_input: 'kind',
                cases: { A: 'a', B: 'b' },
                reviews: [],
                inputs: { kind: { source: 'caller', name: 'label' } },
              },
            ],
          },
          method_titles: { a: '费用核对', b: '税务核对' },
          patterns: ['P5'],
        }}
      />
    </NextIntlClientProvider>,
  )
  const adopt = screen.getByRole('button', { name: /采用/ })
  const confirm = screen.getByRole('checkbox', { name: /我已核对/ })
  expect(adopt).toBeDisabled()
  fireEvent.click(screen.getByRole('radio', { name: '不需要' }))
  expect(screen.getByText(/当前草图与这个选择不符/)).toBeVisible()
  fireEvent.click(screen.getByRole('radio', { name: '需要' }))
  const labels = screen.getByRole('textbox', { name: /填写所有分派标识/ })
  fireEvent.change(labels, { target: { value: 'A' } })
  expect(confirm).toBeDisabled()
  fireEvent.change(labels, { target: { value: 'A\nB\nC' } })
  expect(confirm).toBeDisabled()
  fireEvent.change(labels, { target: { value: 'A\nB' } })
  fireEvent.click(confirm)
  fireEvent.change(screen.getByRole('textbox', { name: /费用核对/ }), {
    target: { value: '按原单标识分派' },
  })
  expect(adopt).toBeDisabled()
  expect(onAdopt).not.toHaveBeenCalled()
  fireEvent.click(confirm)
  fireEvent.click(adopt)
  expect(onAdopt).toHaveBeenCalledWith({
    confirmed: true,
    routing_required: true,
    cases: { dispatch: ['A', 'B'] },
    step_text: { dispatch: '按原单标识分派' },
  })
})
