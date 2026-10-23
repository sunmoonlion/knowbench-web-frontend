import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkSidePanel } from '@/components/workbench/side-panel'
import { PANE_WIDTHS_KEY, usePaneWidths } from '@/lib/pane-widths'
import { WorkbenchProvider } from '@/lib/workbench/context'
import { forgetTicket } from '@/lib/workbench/local-agent'
import messages from '@/messages/zh-CN.json'

const ENV = '33333333-3333-4333-8333-333333333333'
const LOCAL = 'http://127.0.0.1:47811'
const ticket = {
  ticket: 'h.e.s',
  expires_at: Math.floor(Date.now() / 1000) + 600,
  relay_user: 'u-abc',
}

type Answer = { status: number; body: unknown; headers?: Record<string, string>; raw?: boolean }
let answers: Record<string, Answer | ((url: URL) => Answer)> = {}
let seen: { url: string; auth: string | null; origin: boolean }[] = []

beforeEach(() => {
  seen = []
  forgetTicket(ENV)
  answers = {
    // 这台电脑上有代理
    [`${LOCAL}/presence`]: {
      status: 200,
      body: { agent: 'sunmoon-agent', version: '0.4.0', machine_name: 'zymun', connected: true },
    },
    // 工作台只发票
    [`http://testserver/api/workbench/environments/${ENV}/local-ticket`]: {
      status: 200,
      body: ticket,
    },
    [`${LOCAL}/local/v1/info`]: {
      status: 200,
      body: {
        agent: 'sunmoon-agent',
        version: '0.4.0',
        userId: 'u-abc',
        roots: ['C:\\r'],
        libraryDir: 'D:\\lib',
      },
    },
    [`${LOCAL}/local/v1/fs/dir`]: (url) => {
      const path = url.searchParams.get('path')
      if (path === 'C:\\r') {
        return {
          status: 200,
          body: {
            path,
            entries: [
              { name: '恒瑞医药', type: 'dir' },
              { name: 'README.md', type: 'file', size: 12 },
            ],
          },
        }
      }
      if (path === 'C:\\r\\恒瑞医药') {
        return {
          status: 200,
          body: { path, entries: [{ name: '笔记.md', type: 'file', size: 9 }], truncated: false },
        }
      }
      return { status: 404, body: { code: 'not_found', message: 'no' } }
    },
    [`${LOCAL}/local/v1/fs/file`]: {
      status: 200,
      raw: true,
      body: '# 标题\n正文',
      headers: { 'X-File-Size': '13', 'X-File-Eof': 'true' },
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://testserver')
      const headers = (init.headers ?? {}) as Record<string, string>
      seen.push({
        url: url.origin + url.pathname + url.search,
        auth: headers.Authorization ?? null,
        origin: url.origin === LOCAL,
      })
      const found = answers[url.origin + url.pathname]
      const answer = typeof found === 'function' ? found(url) : found
      if (!answer) return new Response(JSON.stringify({ code: 'not_found' }), { status: 404 })
      const body = answer.raw
        ? new TextEncoder().encode(String(answer.body))
        : JSON.stringify(answer.body)
      return new Response(body, {
        status: answer.status,
        headers: {
          'Content-Type': answer.raw ? 'application/octet-stream' : 'application/json',
          ...answer.headers,
        },
      })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function panel(environment: string | null, directory: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <QueryClientProvider client={client}>
        <WorkbenchProvider csrfToken="csrf" locale="zh-CN">
          <WorkSidePanel files={[]} directory={directory} live={false} environment={environment} />
        </WorkbenchProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('右边栏「文件」：直接问本机代理，文件不经云端', () => {
  it('探口 → 要票 → 看树；当前项目默认展开；点文件看内容', async () => {
    panel(ENV, 'C:\\r\\恒瑞医药')
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    const tree = await screen.findByRole('tree', { name: '文件' })
    expect(within(tree).getByText('C:\\r')).toBeInTheDocument()
    expect(within(tree).getByText('本地知识库')).toBeInTheDocument()
    expect(await within(tree).findByText('笔记.md')).toBeInTheDocument()
    expect(within(tree).getByText('README.md')).toBeInTheDocument()
    // 文件内容只向 127.0.0.1 要，工作台那边只被要了一张票
    const cloud = seen.filter((each) => !each.origin).map((each) => each.url)
    expect(cloud).toEqual([`http://testserver/api/workbench/environments/${ENV}/local-ticket`])
    // 每一次敲代理都带着票；探口那次不用
    for (const each of seen.filter((each) => each.origin && !each.url.endsWith('/presence'))) {
      expect(each.auth).toBe('Bearer h.e.s')
    }
    expect(seen.some((each) => each.url.includes(encodeURIComponent('D:\\lib')))).toBe(false)
    fireEvent.click(within(tree).getByRole('button', { name: /笔记\.md/ }))
    expect(await screen.findByRole('heading', { name: '标题' })).toBeInTheDocument()
    expect(screen.getByText('正文')).toBeInTheDocument()
    expect(seen.some((each) => each.url.startsWith(`${LOCAL}/local/v1/fs/file?path=`))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '返回文件树' }))
    expect(await screen.findByRole('tree', { name: '文件' })).toBeInTheDocument()
  })

  it('完整读到的 Markdown 能导出 Word、Excel、PDF；没有表格时 Excel 不可点；只读了开头的不给导出（0031）', async () => {
    const open = async () => {
      panel(ENV, 'C:\\r\\恒瑞医药')
      fireEvent.click(screen.getByRole('button', { name: '文件' }))
      const tree = await screen.findByRole('tree', { name: '文件' })
      fireEvent.click(await within(tree).findByRole('button', { name: /笔记\.md/ }))
      await screen.findByRole('heading', { name: '标题' })
    }
    answers[`${LOCAL}/local/v1/fs/file`] = {
      status: 200,
      raw: true,
      body: '# 标题\n\n| 科目 | 2024 |\n| --- | --- |\n| 营业收入 | 100 |\n',
      headers: { 'X-File-Size': '60', 'X-File-Eof': 'true' },
    }
    await open()
    expect(screen.getByRole('button', { name: '下载 Word' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '下载 Excel' })).toBeEnabled()
    // PDF：只把渲染好的成稿放进打印区，标题换成文件名，打印框关了复原
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const title = document.title
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }))
    expect(print).toHaveBeenCalledOnce()
    const root = document.getElementById('export-print-root')!
    expect(root.textContent).toContain('营业收入')
    expect(root.textContent).not.toContain('下载 Word')
    expect(document.documentElement.classList.contains('exporting-print')).toBe(true)
    expect(document.title).toBe('笔记')
    window.dispatchEvent(new Event('afterprint'))
    expect(document.getElementById('export-print-root')).toBeNull()
    expect(document.documentElement.classList.contains('exporting-print')).toBe(false)
    expect(document.title).toBe(title)
  })

  it('没有表格的 Markdown：Excel 不可点；只读了开头的：不给导出', async () => {
    const open = async () => {
      panel(ENV, 'C:\\r\\恒瑞医药')
      fireEvent.click(screen.getByRole('button', { name: '文件' }))
      const tree = await screen.findByRole('tree', { name: '文件' })
      fireEvent.click(await within(tree).findByRole('button', { name: /笔记\.md/ }))
      await screen.findByRole('heading', { name: '标题' })
    }
    await open()
    expect(screen.getByRole('button', { name: '下载 Excel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下载 Word' })).toBeEnabled()
    cleanup()
    answers[`${LOCAL}/local/v1/fs/file`] = {
      status: 200,
      raw: true,
      body: '# 标题\n正文',
      headers: { 'X-File-Size': '9000000', 'X-File-Eof': 'false' },
    }
    await open()
    expect(screen.queryByRole('button', { name: '下载 Word' })).toBeNull()
  })

  it('右栏的分割线能拖，往左变宽，记住宽度；双击复原（所有者 2026-10-17）', async () => {
    // 宽屏：中间那一栏留够 360px 之后，两边才放得开
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
    window.localStorage.clear()
    usePaneWidths.setState({
      widths: { sidebar: null, side: null },
      sidebarCollapsed: false,
      ready: false,
    })
    panel(ENV, 'C:\\r\\恒瑞医药')
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    const handle = await screen.findByRole('separator', { name: messages.panes.side })
    const aside = handle.closest('aside')!
    expect(aside.style.width).toBe('384px')
    fireEvent.pointerDown(handle, { button: 0, clientX: 600, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(aside.style.width).toBe('484px')
    expect(JSON.parse(window.localStorage.getItem(PANE_WIDTHS_KEY)!).side).toBe(484)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(aside.style.width).toBe('500px')
    fireEvent.doubleClick(handle)
    expect(aside.style.width).toBe('384px')
  })

  it('这台电脑上没有代理：说明白，不去要票', async () => {
    delete answers[`${LOCAL}/presence`]
    panel(ENV, null)
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('没有在运行的本地 link')
    expect(seen.some((each) => each.url.includes('local-ticket'))).toBe(false)
  })

  it('代理接的是别的账号：说明白', async () => {
    answers[`${LOCAL}/local/v1/info`] = {
      status: 200,
      body: { userId: 'u-someone-else', roots: ['C:\\r'] },
    }
    panel(ENV, null)
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('别的账号')
  })

  it('收起的右栏，点顶上的展开钮能展开，回到收起前那一栏（所有者 2026-10-18）', async () => {
    panel(null, null)
    const expand = screen.getByRole('button', { name: messages.panes.expandSide })
    fireEvent.click(expand)
    expect(screen.getByRole('complementary', { name: messages.results.title }).dataset.state).toBe(
      'open',
    )
    fireEvent.click(screen.getByRole('button', { name: '改动' }))
    fireEvent.click(screen.getByRole('button', { name: messages.results.close }))
    fireEvent.click(screen.getByRole('button', { name: messages.panes.expandSide }))
    expect(screen.getByRole('button', { name: /改动/, pressed: true })).toBeInTheDocument()
  })

  it('没有电脑的对话：没有文件可看', () => {
    panel(null, null)
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    expect(screen.getByText('这段对话不在哪台电脑上，没有文件可看。')).toBeInTheDocument()
  })
})
