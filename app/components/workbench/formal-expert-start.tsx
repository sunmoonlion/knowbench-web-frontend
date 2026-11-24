'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useRef, useState, type Ref } from 'react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { formalMethodReferenceSchema as pin } from '@/lib/workbench/formal-method-reference'
import { getJson } from '@/lib/workbench/http'
import { startRound } from '@/lib/workbench/start-formal-match'

export function FormalExpertStart({
  project,
  question,
  from = null,
  task = null,
  ended = false,
  blocked,
  startButtonRef,
  onStarted,
}: {
  project: string
  question: string
  from?: string | null
  task?: string | null
  ended?: boolean
  blocked: boolean
  startButtonRef?: Ref<HTMLButtonElement>
  onStarted: (id: string) => void
}) {
  const t = useTranslations('formalIntake')
  const { csrfToken } = useWorkbench()
  const availability = useQuery({
    queryKey: ['formal-expert-entry'],
    queryFn: () => getJson(z.object({ unified: z.boolean() }), '/api/workbench/expert/entry'),
  })
  const params = useSearchParams()
  const [submitted, setSubmitted] = useState<string | null>(null)
  const named = params.get('formalReference')
  let reference: z.infer<typeof pin> | undefined
  if (named !== null) {
    try {
      reference = pin.parse(JSON.parse(named))
    } catch {
      /* report an invalid pin before matching */
    }
  }
  const [empty, setEmpty] = useState<{ search: string; next: number | null } | null>(null)
  const pending = useRef<{ identity: string; key: string } | null>(null)
  const locked = useRef(false)
  const current = question.trim()
  const search = JSON.stringify([project, from, task, current, named])
  const emptyPage = empty?.search === search ? empty : null
  const offset = emptyPage?.next ?? 0
  const start = useMutation({
    mutationFn: async () => {
      const storageKey = `workbench.formal-intake.${project}`
      const identity = offset ? JSON.stringify([search, offset]) : search
      if (!pending.current || pending.current.identity !== identity) {
        let key = crypto.randomUUID()
        try {
          const old = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
          if (old?.identity === identity && z.uuid().safeParse(old.key).success) key = old.key
        } catch {
          /* retry still works within this page */
        }
        pending.current = { identity, key }
      }
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(pending.current))
      } catch {
        /* optional */
      }
      const result = await startRound(project, csrfToken, {
        idempotency_key: pending.current.key,
        question: current,
        ...(offset ? { directory_offset: offset } : {}),
        ...(reference ? { reference } : {}),
        ...(task && !ended ? { revises: task } : {}),
        ...(from ? { source_session: from } : {}),
      })
      if ('task_id' in result) {
        setSubmitted(search)
        onStarted(result.task_id)
      }
      setEmpty('empty' in result ? { search, next: result.next } : null)
      pending.current = null
      try {
        sessionStorage.removeItem(storageKey)
      } catch {
        /* optional */
      }
    },
    retry: false,
  })
  return (
    <div className="space-y-2">
      {availability.data?.unified === false && <p>{t('unavailableAccount')}</p>}
      {availability.isError && <p role="alert">{t('availabilityError')}</p>}
      {named !== null && (
        <p>
          {reference
            ? t('named', { id: reference.method_id, version: reference.version })
            : t('invalidPin')}
        </p>
      )}
      <Button
        type="button"
        ref={startButtonRef}
        disabled={
          availability.data?.unified !== true ||
          blocked ||
          (named !== null && !reference) ||
          !current ||
          current.length > 2000 ||
          start.isPending ||
          submitted === search
        }
        onClick={async () => {
          if (locked.current) return
          locked.current = true
          try {
            await start.mutateAsync()
          } catch {
            /* shown below */
          } finally {
            locked.current = false
          }
        }}
      >
        {emptyPage?.next ? t('continueSearch') : t('unifiedTitle')}
      </Button>
      <p className="text-muted-foreground text-sm">{t('cost')}</p>
      {emptyPage && <p role="status">{emptyPage.next ? t('emptyWindow') : t('empty')}</p>}
      {start.isError && <p role="alert">{t('failed')}</p>}
    </div>
  )
}
