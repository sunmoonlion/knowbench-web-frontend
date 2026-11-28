import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { expect, it } from 'vitest'
import { StepDetail } from '@/features/expert/ui/parts'
import { runStepDetailSchema } from '@/contracts/workbench-v2'
import sample from '@/preview/fixtures/full/0157.json'
import messages from '@/messages/zh-CN.json'

it('已验结果带九列和十三条依据，核对页面可见内容', () => {
  const step = runStepDetailSchema.parse(sample).step
  const attempt = step.attempts.find((item) => item.returned)
  if (!attempt?.returned) throw new Error('fixture needs a returned artifact')
  attempt.returned.content = {
    表: [Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['列' + (i + 1), '值' + (i + 1)]))],
    依据: Array.from({ length: 13 }, (_, i) => '凭据' + (i + 1)),
  }
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <StepDetail step={step} loading={false} />
    </NextIntlClientProvider>,
  )
  expect(screen.getByRole('columnheader', { name: '列8' })).toBeVisible()
  expect(screen.queryByText('列9')).toBeNull()
  expect(screen.getByText(/凭据12/)).toBeVisible()
  expect(screen.queryByText(/凭据13/)).toBeNull()
  expect(screen.getByText('还有 1 列')).toBeVisible()
  expect(screen.getByText('还有 1 项')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '展开完整结果' }))
  expect(screen.getByRole('columnheader', { name: '列9' })).toBeVisible()
  expect(screen.getByText(/凭据13/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '收起结果' }))
  expect(screen.queryByRole('columnheader', { name: '列9' })).toBeNull()
})
