'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { sessionRecovery } from '@/lib/auth/session-recovery'
import type { RunAction } from '@/contracts/interaction'
import { cancelRun, fetchRunSnapshot, parseRunEventPayload, submitRunAction } from './client'
import { applyRunEvent, createRunProjection, type RunProjection } from './projection'

export type StreamState = 'connecting' | 'open' | 'reconciling' | 'offline' | 'closed'

export function useRunProjection(runId: string, csrfToken: string) {
  const queryClient = useQueryClient()
  const expired = useSyncExternalStore(
    sessionRecovery.subscribe,
    sessionRecovery.snapshot,
    () => false,
  )
  const queryKey = ['run-snapshot', runId] as const
  const query = useQuery({
    queryKey,
    queryFn: () => fetchRunSnapshot(runId),
    enabled: !expired,
  })
  const [projection, setProjection] = useState<RunProjection | null>(null)
  const projectionRef = useRef<RunProjection | null>(null)
  const [streamState, setStreamState] = useState<StreamState>('connecting')
  const refetch = query.refetch

  useEffect(() => {
    if (expired || !query.data || isTerminal(query.data.status)) {
      return
    }
    if (
      !projectionRef.current ||
      query.data.last_sequence_no >= projectionRef.current.snapshot.last_sequence_no
    ) {
      projectionRef.current = createRunProjection(query.data)
    }

    let stopped = false
    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0

    const reconcile = async () => {
      setStreamState('reconciling')
      source?.close()
      await refetch()
    }

    const connect = () => {
      if (stopped) return
      const cursor = projectionRef.current?.snapshot.last_event_id
      const params = cursor ? `?last_event_id=${encodeURIComponent(cursor)}` : ''
      setStreamState(reconnectAttempt ? 'offline' : 'connecting')
      source = new EventSource(`/api/web/v1/runs/${encodeURIComponent(runId)}/events${params}`, {
        withCredentials: true,
      })
      source.onopen = () => {
        reconnectAttempt = 0
        setStreamState('open')
      }
      source.addEventListener('run-event', (message) => {
        if (!(message instanceof MessageEvent) || !projectionRef.current) return
        try {
          const event = parseRunEventPayload(String(message.data), message.lastEventId)
          const result = applyRunEvent(projectionRef.current, event)
          if (result.kind === 'gap') {
            void reconcile()
            return
          }
          if (result.kind !== 'applied') return
          projectionRef.current = result.projection
          setProjection(result.projection)
          if (isTerminal(result.projection.snapshot.status)) void reconcile()
        } catch {
          void reconcile()
        }
      })
      source.onerror = () => {
        source?.close()
        if (stopped) return
        setStreamState('offline')
        const delay =
          Math.min(1000 * 2 ** reconnectAttempt, 10000) + Math.floor(Math.random() * 250)
        reconnectAttempt += 1
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      stopped = true
      source?.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [query.data, refetch, runId, expired])

  const action = useMutation({
    mutationFn: (command: RunAction) => submitRunAction(runId, command, csrfToken),
    onSuccess: (snapshot) => queryClient.setQueryData(queryKey, snapshot),
  })
  const cancel = useMutation({
    mutationFn: (reason?: string) =>
      cancelRun(
        runId,
        {
          contract_version: 1,
          idempotency_key: crypto.randomUUID(),
          reason: reason || null,
        },
        csrfToken,
      ),
    onSuccess: (snapshot) => queryClient.setQueryData(queryKey, snapshot),
  })

  const snapshot =
    query.data &&
    (!projection || query.data.last_sequence_no >= projection.snapshot.last_sequence_no)
      ? query.data
      : (projection?.snapshot ?? null)

  return {
    snapshot,
    streamState: snapshot && isTerminal(snapshot.status) ? 'closed' : streamState,
    queryError: query.error,
    isLoading: query.isLoading,
    action,
    cancel,
  }
}

function isTerminal(status: string): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(status)
}
