import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AskExpertScreen, ExpertHomeScreen } from '@/features/expert'
import { WorkbenchProvider } from '@/lib/workbench/context'
import messages from '@/messages/zh-CN.json'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/zh-CN/workbench/expert',
}))

const full = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as {
  pages: { title: string; path: string }[]
  responses: { method: string; path: string; query: string; file: string }[]
}
function sample(path: string): unknown {
  const found = manifest.responses.find((each) => each.method === 'GET' && each.path === path)
  return found ? JSON.parse(readFileSync(join(full, found.file), 'utf8')) : null
}
const parts = (title: string) =>
  manifest.pages.find((page) => page.title.startsWith(title))!.path.split('/')

class FakeEventSource {
  onopen: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {}
  close() {}
}

type Call = { method: string; path: string; body: Record<string, unknown> }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  push.mockReset()
  window.sessionStorage.clear()
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = String(input).split('?')[0]
      const method = init.method ?? 'GET'
      if (method !== 'GET') {
        calls.push({ method, path, body: JSON.parse(String(init.body ?? '{}')) })
        return new Response(
          JSON.stringify({
            task_id: '11111111-1111-4111-8111-111111111111',
            session_id: '22222222-2222-4222-8222-222222222222',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      const body = sample(path)
      return new Response(JSON.stringify(body ?? { code: 'not_found' }), {
        status: body ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function page(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages} timeZone="Asia/Shanghai">
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf-for-test" locale="zh-CN">
          {children}
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('专家首页', () => {
  it('等我决定的在最上面；进行中的；两位专家；最近交回的。哪里都没有代号', async () => {
    page(<ExpertHomeScreen />)
    const waiting = within(await screen.findByRole('region', { name: '等我决定' }))
    expect(waiting.getAllByRole('link', { name: '去处理' })).toHaveLength(2)
    expect(waiting.getByText(/第 3 步「勾稽」/)).toBeInTheDocument()
    expect(waiting.getByText('有勾稽规则不平，不往下算')).toBeInTheDocument()
    const running = within(screen.getByRole('region', { name: '进行中' }))
    expect(running.getByText('第 3 步，共 5 步')).toBeInTheDocument()
    const packs = within(screen.getByRole('region', { name: '有哪些专家' }))
    expect(await packs.findByRole('heading', { name: '财报体检' })).toBeInTheDocument()
    expect(packs.getByRole('heading', { name: '问数' })).toBeInTheDocument()
    expect(packs.getByRole('button', { name: '删除 财报体检' })).toBeInTheDocument()
    expect(packs.getByRole('button', { name: '删除 问数' })).toBeInTheDocument()
    expect(packs.getByText('7 步 · 要用我们的数据')).toBeInTheDocument()
    const returned = within(screen.getByRole('region', { name: '最近交回的' }))
    expect(returned.getByText('打回')).toBeInTheDocument()
    expect(returned.getAllByText('已完成').length).toBeGreaterThan(0)
    // 代号是我们自己用的，不给用户看（AT-INV-17）
    for (const code of ['FIN_REVIEW', 'DATA_QUERY', 'SMOKE']) {
      expect(document.body.textContent).not.toContain(code)
    }
  })
})

describe('请专家', () => {
  const project = parts('项目页')[4]

  it('没选专家时交不出去；选了一位，右边写出它会怎么做', async () => {
    page(<AskExpertScreen project={project} from={null} expert={null} />)
    expect(await screen.findByText('先在左边选一位专家。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '交给专家' })).toBeDisabled()
    fireEvent.click(await screen.findByRole('button', { name: '财报体检' }))
    expect(screen.getByRole('heading', { name: '请专家：财报体检' })).toBeInTheDocument()
    // 每一步：名字、一句白话、不过时怎么办。没有方法的原文
    expect(screen.getByText('3 勾稽')).toBeInTheDocument()
    expect(
      screen.getByText('→ 重做，最多 1 次；仍不过，退回第 2 步，最多 1 次；仍不过，停下来问你'),
    ).toBeInTheDocument()
    expect(screen.getByText(/预测、估值、评级、买卖或仓位建议/)).toBeInTheDocument()
    // 换一位：右边整个换掉（AT-INV-18）
    fireEvent.click(screen.getByRole('button', { name: '问数' }))
    expect(screen.queryByText('3 勾稽')).toBeNull()
    expect(screen.getByText('3 执行 SQL')).toBeInTheDocument()
    // 不填预算；专家看得到什么只数数
    expect(screen.queryByText(/预算/)).toBeNull()
    expect(screen.getByText('项目里别的 3 段对话、1 次专家交回')).toBeInTheDocument()
  })

  it('从专家入口交出：建对话并交出，一次提交；不带预算上限', async () => {
    window.sessionStorage.setItem(
      'workbench.question',
      '恒瑞医药 2023 到 2025 年的盈利能力怎么样？',
    )
    page(<AskExpertScreen project={project} from={null} expert="FIN_REVIEW" />)
    const box = await screen.findByRole('textbox', { name: '要解决什么问题' })
    // 首页写的那句带进来了
    await waitFor(() => expect(box).toHaveValue('恒瑞医药 2023 到 2025 年的盈利能力怎么样？'))
    const submit = screen.getByRole('button', { name: '交给专家' })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].path).toBe(`/api/workbench/projects/${project}/delegations`)
    expect(calls[0].body).toMatchObject({
      expert: 'FIN_REVIEW',
      question: '恒瑞医药 2023 到 2025 年的盈利能力怎么样？',
    })
    expect(Object.keys(calls[0].body).sort()).toEqual(['expert', 'idempotency_key', 'question'])
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/zh-CN/workbench/projects/${project}/c/22222222-2222-4222-8222-222222222222`,
      ),
    )
  })

  it('从对话里交出：带入那段对话里最近说的一句，专家接着那段对话做', async () => {
    const chat = parts('项目里的聊天')
    page(<AskExpertScreen project={chat[4]} from={chat[6]} expert="DATA_QUERY" />)
    const box = await screen.findByRole('textbox', { name: '要解决什么问题' })
    await waitFor(() => expect(box).toHaveValue('帮我把这两句概括写进 notes/概括.md。'))
    expect(screen.getByText('这段对话（3 轮）')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: '恒瑞医药近五年的毛利率分别是多少？' } })
    fireEvent.click(screen.getByRole('button', { name: '交给专家' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].path).toBe(`/api/workbench/sessions/${chat[6]}/handover`)
    expect(calls[0].body).toMatchObject({
      profile_id: 'DATA_QUERY',
      original_input: { text: '恒瑞医药近五年的毛利率分别是多少？' },
    })
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/zh-CN/workbench/projects/${chat[4]}/c/${chat[6]}`),
    )
  })

  it('这个项目里专家还在做：仍能提交，说明等待执行', async () => {
    const busy = parts('专家处理中')
    page(<AskExpertScreen project={busy[4]} from={null} expert="DATA_QUERY" />)
    expect(
      await screen.findByText('专家已选好；提交后将排队，前一项委托结束后开始执行。'),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '要解决什么问题' }), {
      target: { value: '问' },
    })
    expect(screen.getByRole('button', { name: '交给专家' })).toBeEnabled()
  })
})
