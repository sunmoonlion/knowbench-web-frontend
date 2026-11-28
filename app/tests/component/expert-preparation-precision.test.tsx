// 复制到 KnowBench Web 的 tests/component 下运行。只使用内存中的 HTTP 响应。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { ExpertPreparation } from '@/features/expert/ui/formal-expert-preparation'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

afterEach(() => vi.unstubAllGlobals())

it('记录正式整数在输入框和保存 HTTP 正文中的实际取值', async () => {
  const initial = {
    revision: 0,
    input_types: { row_id: 'integer' },
    bindings: { values: {}, materials: {}, accounts: {}, budget: { currency: 'CNY', limit: '5' } },
    account_options: {},
    materials: [],
    material_names: {},
    invalid_materials: [],
    invalid_accounts: [],
  }
  let sent = ''
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') sent = String(init.body)
      return Response.json(initial)
    }),
  )
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <QueryClientProvider client={new QueryClient()}>
        <WorkbenchProvider csrfToken="test" locale="zh-CN">
          <ExpertPreparation
            task="t"
            fingerprint="f"
            onConfirmed={() => {}}
            scope={{
              steps: [],
              requirements: [],
              outputs: [],
              approvals: [],
              inputs: [{ name: 'row_id', description: '行号', used_by: [], required_by: [] }],
            }}
          />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: messages.formalIntake.prepare }))
  const input = await screen.findByLabelText('本次输入：行号')
  fireEvent.change(input, { target: { value: '9007199254740993' } })
  expect(input).toHaveValue('9007199254740993')
  fireEvent.click(screen.getByRole('button', { name: messages.formalIntake.savePreparation }))
  expect(screen.getByRole('alert')).toHaveTextContent(messages.formalIntake.unsafeInputNumber)
  expect(screen.getByRole('button', { name: messages.formalIntake.savePreparation })).toBeDisabled()
  expect(sent).toBe('')
  fireEvent.change(input, { target: { value: '9007199254740991' } })
  fireEvent.click(screen.getByRole('button', { name: messages.formalIntake.savePreparation }))
  await waitFor(() => expect(sent).toContain('"row_id":9007199254740991'))
})
