'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'

import { useWorkbench } from './context'
import { useStartFind } from './find-expert'
import { routes } from './routes'
import { getJson, seg } from './http'
import { findResultSchema } from '@/contracts/workbench-v2'

type PendingFind = { identity: string; key: string; task?: string }
const DONE = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED'])

// Both question entry points use the same service and durable result URL.
// A lost response keeps its request key. A different question/target starts a new round.
export function useExpertFinder() {
  const start = useStartFind()
  const router = useRouter()
  const { locale } = useWorkbench()
  const pending = useRef<PendingFind | null>(null)
  const inFlight = useRef(false)

  async function find(input: {
    project: string
    question: string
    from: string | null
    expert?: string
  }) {
    if (inFlight.current) return
    inFlight.current = true
    const question = input.question.trim()
    const identity = JSON.stringify([input.project, question, input.expert ?? null, input.from])
    const storageKey = `workbench.find.pending.${input.project}`
    try {
      if (pending.current?.identity !== identity) {
        let saved: Partial<PendingFind> | null = null
        try {
          saved = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null')
        } catch {
          /* optional storage */
        }
        pending.current = {
          identity,
          key:
            saved?.identity === identity && typeof saved.key === 'string'
              ? saved.key
              : crypto.randomUUID(),
          ...(saved?.identity === identity && typeof saved.task === 'string'
            ? { task: saved.task }
            : {}),
        }
      }
      // Only an explicit new click after a terminal result starts another paid round.
      // During execution/retry, reuse the original request and durable task.
      if (pending.current.task) {
        const previous = await getJson(
          findResultSchema,
          `/api/workbench/find-expert/${seg(pending.current.task)}`,
        )
        if (DONE.has(previous.state)) pending.current = { identity, key: crypto.randomUUID() }
      }
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(pending.current))
        window.sessionStorage.setItem('workbench.question', question)
      } catch {
        /* memory key still covers retries in this tab */
      }
      const found = await start.mutateAsync({
        project: input.project,
        question,
        key: pending.current.key,
        expert: input.expert,
      })
      pending.current.task = found.task_id
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(pending.current))
      } catch {
        /* retries in this mounted page still retain the task */
      }
      const url = new URL(
        routes.askExpert(locale, input.project, input.from ?? undefined),
        window.location.origin,
      )
      url.searchParams.set('match', found.task_id)
      router.push(url.pathname + url.search)
    } finally {
      inFlight.current = false
    }
  }
  return { find, isPending: start.isPending, isError: start.isError, error: start.error }
}
