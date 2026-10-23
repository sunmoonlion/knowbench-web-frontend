// 输入框旁「云端知识库」（SDD 0042 第四节）：这段对话选用几份，保存后按钮上写选了几份
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CloudDataButton } from '@/components/workbench/cloud-data-button'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const SESSION = '33333333-3333-4333-8333-333333333333'
const item = (item_id: string, name: string, media_type: string) => ({
  item_id,
  name,
  media_type,
  size_bytes: 10,
  sha256: 'a'.repeat(64),
  origin: 'upload',
  created_at: '2026-10-23T12:00:00Z',
})
let chosen: { item_id: string; name: string }[] = []
let puts: unknown[] = []
let refuse: string | null = null

beforeEach(() => {
  chosen = []
  puts = []
  refuse = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input).split('?')[0]
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      if (path === '/api/workbench/cloud-library') {
        return json({
          items: [
            item('i1', '营收.csv', 'text/csv; charset=utf-8'),
            item('i2', '年报.pdf', 'application/pdf'),
            item('p1', '图.png', 'image/png'),
          ],
        })
      }
      if (path === `/api/workbench/sessions/${SESSION}/cloud-data`) {
        if (init.method === 'PUT') {
          const body = JSON.parse(String(init.body))
          puts.push(body)
          if (refuse) return json({ code: refuse }, 422)
          chosen = body.items.map((id: string) => ({
            item_id: id,
            name: id === 'i1' ? '营收.csv' : '年报.pdf',
          }))
        }
        return json({
          items: chosen.map((each) => ({
            ...each,
            media_type: 'text/csv',
            size_bytes: 1,
            sha256: 'a'.repeat(64),
          })),
          expires_at: chosen.length ? '2026-10-24T12:00:00Z' : null,
        })
      }
      return json({ code: 'not_found' }, 404)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function page() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-for-test" locale="zh-CN">
          <CloudDataButton session={SESSION} />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('这段对话选用云端知识库', () => {
  it('只列读得成文字的；选了保存，按钮上写几份；不用了就清空', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: '云端知识库' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(await dialog.findByRole('button', { name: /营收\.csv/ })).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: /图\.png/ })).toBeNull()
    fireEvent.click(dialog.getByRole('button', { name: /营收\.csv/ }))
    fireEvent.click(dialog.getByRole('button', { name: /年报\.pdf/ }))
    fireEvent.click(dialog.getByRole('button', { name: '选用 2 份' }))
    await waitFor(() => expect(puts).toEqual([{ items: ['i1', 'i2'] }]))
    expect(await screen.findByRole('button', { name: /云端知识库 · 2 份/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /云端知识库 · 2 份/ }))
    const again = within(await screen.findByRole('dialog'))
    fireEvent.click(await again.findByRole('button', { name: /营收\.csv/ }))
    fireEvent.click(again.getByRole('button', { name: /年报\.pdf/ }))
    fireEvent.click(again.getByRole('button', { name: '不用了' }))
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(await screen.findByRole('button', { name: '云端知识库' })).toBeInTheDocument()
  })

  it('后端拒了照实说，不关对话框', async () => {
    refuse = 'reauth_required'
    page()
    fireEvent.click(await screen.findByRole('button', { name: '云端知识库' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(await dialog.findByRole('button', { name: /营收\.csv/ }))
    fireEvent.click(dialog.getByRole('button', { name: '选用 1 份' }))
    expect(await dialog.findByText('登录过期了，请重新登录再选。')).toBeInTheDocument()
  })
})
