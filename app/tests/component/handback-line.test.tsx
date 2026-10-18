import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import { TimelineEntry } from '@/features/work/ui/entries'
import type { Entry } from '@/lib/workbench/timeline'
import messages from '@/messages/zh-CN.json'

function line(entry: Entry) {
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <TimelineEntry
        entry={entry}
        directory={null}
        waiting={[]}
        answering={false}
        onAnswer={vi.fn()}
        onOpenDossier={vi.fn()}
      />
    </NextIntlClientProvider>,
  )
}

describe('专家交回那一行', () => {
  it('不写成稿文件的专家：不提工作底稿、不给按钮（qwen-005 走查：分身只回结果，右栏底稿是空的）', () => {
    for (const outcome of ['succeeded', 'stopped', 'failed'] as const) {
      const view = line({
        kind: 'handover',
        key: outcome,
        what: 'returned',
        outcome,
        writesFiles: false,
      })
      expect(screen.getByText(/不写成稿文件/)).toBeInTheDocument()
      expect(screen.queryByText(/右边栏/)).toBeNull()
      expect(screen.queryByRole('button', { name: '打开工作底稿' })).toBeNull()
      view.unmount()
    }
  })

  it('做完了：叫人去看工作底稿', () => {
    line({ kind: 'handover', key: 'a', what: 'returned', outcome: 'succeeded' })
    expect(screen.getByRole('button', { name: '打开工作底稿' })).toBeInTheDocument()
  })

  it('受理时就打回：说出为什么，不提底稿（2026-10-14 现网：版本对不上被打回，页面却说底稿在右边栏）', () => {
    line({
      kind: 'handover',
      key: 'b',
      what: 'returned',
      outcome: 'rejected',
      reason: '这个委托是按专家的旧版建的，旧版已经换下，请重新请一次专家',
    })
    expect(screen.getByText(/一步也没做.*旧版已经换下/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开工作底稿' })).toBeNull()
    expect(screen.queryByText(/右边栏/)).toBeNull()
  })
})
