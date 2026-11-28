'use client'

import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

// 输入框。模型在答的时候，发送钮变成停止钮：随时能停。
export function Composer({
  busy,
  sending,
  stopping,
  problem,
  onSend,
  onStop,
  children,
  placeholder,
  disabledReason = null,
  footer = null,
}: {
  busy: boolean
  sending: boolean
  stopping: boolean
  problem: string | null
  onSend: (text: string) => Promise<unknown>
  onStop: () => void
  children?: React.ReactNode
  placeholder: string
  // 不能说话的时候（专家正在处理）：输入框禁用，这里写原因
  disabledReason?: string | null
  // 输入框下面那行小字的左半边（花费）；右半边是固定的提示
  footer?: React.ReactNode
}) {
  const t = useTranslations('conversation')
  const [draft, setDraft] = useState('')
  const ready = draft.trim().length > 0 && !busy && !sending && disabledReason === null

  async function send() {
    if (!ready) return
    const text = draft.trim()
    try {
      await onSend(text)
      setDraft((current) => (current === draft ? '' : current))
    } catch {
      // 没发出去：话留在输入框里，原因由上面显示
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      {problem ? (
        <p role="alert" className="text-destructive mb-2 text-[13px]">
          {problem}
        </p>
      ) : null}
      <div className="bg-background focus-within:border-ring rounded-2xl border p-2 shadow-xs">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send()
            }
          }}
          rows={2}
          aria-label={t('composer.label')}
          placeholder={disabledReason ?? placeholder}
          disabled={disabledReason !== null}
          className="max-h-[40vh] min-h-12 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-2 px-1 pt-1">
          {children}
          <div className="flex-1" />
          {busy && disabledReason === null ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              onClick={onStop}
              disabled={stopping}
              aria-label={t('composer.stop')}
              title={t('composer.stop')}
            >
              <SquareIcon className="fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={() => void send()}
              disabled={!ready}
              aria-label={t('composer.send')}
              title={t('composer.send')}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
      <div
        className={cn(
          'text-muted-foreground mt-1.5 flex items-center gap-3 text-xs',
          footer ? 'justify-between' : 'justify-center',
        )}
      >
        {footer}
        <p className="truncate">{t('composer.hint')}</p>
      </div>
    </div>
  )
}
