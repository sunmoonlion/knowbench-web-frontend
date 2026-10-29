'use client'

import { ChevronRightIcon, LoaderIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Markdown } from '@/components/common/markdown'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import { StepLine } from '@/components/workbench/step-line'
import { cn } from '@/lib/utils'

import { tally, type TurnView } from '../model/thread'

// 过程：默认收成一行，点开才看细节。还在跑的时候这一行说的是它这会儿在干什么。
function Process({ turn }: { turn: TurnView }) {
  const t = useTranslations('chat')
  const tc = useTranslations('conversation')
  const [open, setOpen] = useState(false)
  const counted = tally(turn.steps)
  const parts = [
    counted.data ? t('tally.data', { count: counted.data }) : null,
    counted.files ? t('tally.files', { count: counted.files }) : null,
    counted.commands ? t('tally.commands', { count: counted.commands }) : null,
  ].filter(Boolean)
  const busy = turn.activity !== null
  if (!busy && turn.steps.length === 0) return null
  const expandable = turn.steps.length > 0
  return (
    <div className="w-full">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen(!open)}
        className={cn(
          'text-muted-foreground flex items-center gap-2 rounded-md py-1 text-[13px]',
          expandable && 'hover:text-foreground',
        )}
      >
        {busy ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
        <span>
          {busy ? tc(`activity.${turn.activity}`) : parts.join(' · ') || t('tally.said')}
          {busy && parts.length ? ` · ${parts.join(' · ')}` : ''}
          {counted.failed ? ` · ${t('tally.failed', { count: counted.failed })}` : ''}
        </span>
        {expandable ? (
          <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        ) : null}
      </button>
      {open ? (
        <div className="mt-1 space-y-0.5 border-l pl-3">
          {turn.steps.map((step) =>
            step.kind === 'said' ? (
              <p key={`said:${step.id}`} className="text-muted-foreground text-[13px] leading-6">
                {step.text}
              </p>
            ) : (
              <StepLine key={`${step.kind}:${step.id}`} step={step} />
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}

export function Turn({ turn }: { turn: TurnView }) {
  const t = useTranslations('conversation')
  return (
    <div className="flex flex-col gap-3" data-turn-status={turn.status}>
      <Message align="end">
        <MessageContent>
          <Bubble variant="secondary" align="end">
            <BubbleContent className="whitespace-pre-wrap">{turn.text}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <Message>
        <MessageContent>
          <Process turn={turn} />
          {turn.answer ? <Markdown>{turn.answer.text}</Markdown> : null}
          {turn.status === 'interrupted' ? (
            <Marker>
              <MarkerContent>{t('stopped')}</MarkerContent>
            </Marker>
          ) : null}
          {turn.status === 'failed' ? (
            <Marker className="text-destructive">
              <MarkerContent>{t('failed')}</MarkerContent>
            </Marker>
          ) : null}
        </MessageContent>
      </Message>
    </div>
  )
}
