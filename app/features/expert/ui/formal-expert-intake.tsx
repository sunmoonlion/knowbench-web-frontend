'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { formalMethodReferenceSchema as pin } from '@/lib/workbench/formal-method-reference'
import { routes } from '@/lib/workbench/routes'
import { readRound, startRound, selectVersion } from '../api/formal-expert'
import { ExpertPreparation } from './formal-expert-preparation'
import { ScopePreview } from './formal-expert-scope'

const terminal = new Set(['SUCCEEDED', 'CANCELLED', 'FAILED', 'REJECTED'])
const pinKey = (p: z.infer<typeof pin>) => [p.method_id, p.version, p.digest].join('/')

export function FormalExpertIntake({
  project,
  question,
  onRestore,
  from,
}: {
  project: string
  from: string | null
  question: string
  onRestore?: (value: string) => void
}) {
  const t = useTranslations('formalIntake')
  const { csrfToken, locale } = useWorkbench()
  const params = useSearchParams()
  const param = params.get('formalMatch')
  const named = params.get('formalReference')
  let reference: z.infer<typeof pin> | undefined
  if (named !== null) {
    try {
      reference = pin.parse(JSON.parse(named))
    } catch {
      /* report an invalid pin before matching */
    }
  }
  const [task, setTask] = useState(param)
  const [empty, setEmpty] = useState<{ search: string; next: number | null } | null>(null)
  const pending = useRef<{ identity: string; key: string } | null>(null)
  const locked = useRef(false)
  const current = question.trim()
  const search = JSON.stringify([project, from, task, current, named])
  const emptyPage = empty?.search === search ? empty : null
  const offset = emptyPage?.next ?? 0
  const round = useQuery({
    queryKey: ['formal-expert-round', project, task],
    enabled: !!task,
    retry: false,
    queryFn: async () => {
      const data = await readRound(task!)
      if (data.project_id !== project || data.task_id !== task) throw new Error('Unexpected match')
      return data
    },
    refetchInterval: (q) =>
      q.state.error || terminal.has(q.state.data?.state ?? '') ? false : 2000,
  })
  const original = round.data?.question
  useEffect(() => {
    if (original && onRestore) onRestore(original)
  }, [original, onRestore])
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
        ...(task ? { revises: task } : {}),
        ...(from ? { source_session: from } : {}),
      })
      const id = 'task_id' in result ? result.task_id : null
      const url = new URL(window.location.href)
      if (id) url.searchParams.set('formalMatch', id)
      window.history.replaceState(window.history.state, '', url)
      if (id) setTask(id)
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
  const choice = useMutation({
    mutationFn: (reference: z.infer<typeof pin>) =>
      selectVersion(task!, csrfToken, reference, round.data!.formal!.review_digest),
    onSuccess: () => round.refetch(),
    retry: false,
  })
  const same = original === current
  const result = same ? round.data?.formal : undefined
  const busy = !!task && !round.isError && (!round.data || !terminal.has(round.data.state))
  return (
    <section className="space-y-3" aria-label={t('title')}>
      {named !== null && (
        <p>
          {reference
            ? t('named', { id: reference.method_id, version: reference.version })
            : t('invalidPin')}
        </p>
      )}
      <Button
        type="button"
        disabled={
          (named !== null && !reference) ||
          !current ||
          current.length > 2000 ||
          start.isPending ||
          busy ||
          !!result ||
          !!round.data?.superseded_by ||
          (!!task && !round.data)
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
        {emptyPage?.next ? t('continueSearch') : t('title')}
      </Button>
      <p className="text-muted-foreground text-sm">{t('cost')}</p>
      {emptyPage && <p role="status">{emptyPage.next ? t('emptyWindow') : t('empty')}</p>}
      {round.data?.superseded_by && (
        <a
          className="underline"
          href={(() => {
            const url = new URL(window.location.href)
            url.searchParams.set('formalMatch', round.data.superseded_by)
            return url.pathname + url.search
          })()}
        >
          {t('latest')}
        </a>
      )}
      {busy && (
        <p role="status">
          {t('working')}{' '}
          {round.data?.session_id && (
            <a
              className="underline"
              href={routes.projectConversation(locale, project, round.data.session_id)}
            >
              {t('round')}
            </a>
          )}
        </p>
      )}
      {start.isError && <p role="alert">{t('failed')}</p>}
      {round.isError && (
        <p role="alert">
          {t('unavailable')}{' '}
          <Button type="button" variant="outline" onClick={() => void round.refetch()}>
            {t('retry')}
          </Button>
        </p>
      )}
      {same &&
        round.data &&
        terminal.has(round.data.state) &&
        !round.data.superseded_by &&
        !result && <p role="alert">{round.data.error || t('failed')}</p>}
      {result && !round.isError && (
        <>
          {!result.selected && <p>{result.match.explanation}</p>}
          {!result.selected && result.more && (
            <p className="text-muted-foreground text-sm">{t('partial')}</p>
          )}
          {result.match.clarification && <p>{result.match.clarification}</p>}
          {result.match.picks.map((p) => {
            const e = result.options.find((o) => pinKey(o.reference) === pinKey(p.reference))
            if (!e) return null
            return (
              <article key={pinKey(p.reference)} className="space-y-2 rounded-lg border p-3">
                <h3 className="font-medium">
                  {e.declaration.title} · v{p.reference.version}
                </h3>
                <p>{p.reason}</p>
                <ul className="list-disc pl-5">
                  {p.coverage.map((c) => (
                    <li key={c.requirement}>
                      {result.match.requirements.find((r) => r.id === c.requirement)?.statement} —{' '}
                      {e.declaration.promises[c.promise]}
                      {e.declaration.conditions?.[c.promise] && (
                        <p>{t('condition', { value: e.declaration.conditions[c.promise].when })}</p>
                      )}
                    </li>
                  ))}
                </ul>
                {!!e.declaration.excludes.length && (
                  <p>{t('excludes', { value: e.declaration.excludes.join(' · ') })}</p>
                )}
                {p.limitations.map((v, i) => (
                  <p key={i}>{v}</p>
                ))}
                {result.selected ? (
                  pinKey(result.selected) === pinKey(p.reference) && (
                    <p role="status">{t('selected')}</p>
                  )
                ) : (
                  <Button
                    variant="outline"
                    disabled={choice.isPending || round.isFetching}
                    onClick={() => choice.mutate(p.reference)}
                  >
                    {t('choose')}
                  </Button>
                )}
              </article>
            )
          })}
          {result.selected && result.scope_preview && task && (
            <>
              <ScopePreview scope={result.scope_preview} />
              <ExpertPreparation
                key={task + result.review_digest}
                task={task}
                fingerprint={result.review_digest}
                scope={result.scope_preview}
              />
            </>
          )}
          {choice.isError && (
            <p role="alert">
              {t('unavailable')}{' '}
              <Button variant="outline" onClick={() => void round.refetch()}>
                {t('retry')}
              </Button>
            </p>
          )}
        </>
      )}
    </section>
  )
}
