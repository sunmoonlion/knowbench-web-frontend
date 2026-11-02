'use client'

// 一段对话的事件：先按游标把已有的取完，再开实时流接着收；按游标去重。断了退避重连，重连前再补取一次。
// 一段对话只开一条流：页面放一个 Provider，各功能（对话、花费）都从这里读。
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import {
  conversationEventSchema,
  eventsPageSchema,
  type ConversationEvent,
} from '@/contracts/workbench-v2'

import { sessionRecovery } from '@/lib/auth/session-recovery'
import { getJson, seg } from './http'

export type StreamState = 'connecting' | 'live' | 'offline'

type Value = { events: ConversationEvent[]; state: StreamState }

const Context = createContext<Value | null>(null)

const PAGE = 1000

export function ConversationEventsProvider({
  conversation,
  children,
}: {
  conversation: string
  children: React.ReactNode
}) {
  const [events, setEvents] = useState<ConversationEvent[]>([])
  const [state, setState] = useState<StreamState>('connecting')
  const cursor = useRef(0)
  const expired = useSyncExternalStore(
    sessionRecovery.subscribe,
    sessionRecovery.snapshot,
    () => false,
  )

  useEffect(() => {
    if (expired) return
    let stopped = false
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    cursor.current = 0
    setEvents([])

    const append = (incoming: ConversationEvent[]) => {
      const fresh = incoming.filter((event) => event.cursor > cursor.current)
      if (!fresh.length) return
      cursor.current = fresh[fresh.length - 1].cursor
      setEvents((previous) => [...previous, ...fresh])
    }

    const catchUp = async () => {
      for (;;) {
        const page = await getJson(
          eventsPageSchema,
          `/api/workbench/sessions/${seg(conversation)}/events?limit=${PAGE}${
            cursor.current > 0 ? `&after=${cursor.current}` : ''
          }`,
        )
        if (stopped) return
        append(page.events)
        if (page.events.length < PAGE) return
      }
    }

    const connect = async () => {
      if (stopped) return
      setState('connecting')
      try {
        await catchUp()
      } catch {
        if (stopped) return
        setState('offline')
        return retry()
      }
      if (stopped) return
      source = new EventSource(
        `/api/workbench/sessions/${seg(conversation)}/stream?after=${cursor.current}`,
        { withCredentials: true },
      )
      source.onopen = () => {
        attempt = 0
        setState('live')
      }
      source.onmessage = (message) => {
        try {
          append([conversationEventSchema.parse(JSON.parse(message.data))])
        } catch {
          // 坏的一帧丢掉；下一次补取会补上
        }
      }
      source.onerror = () => {
        source?.close()
        source = null
        setState('offline')
        retry()
      }
    }

    const retry = () => {
      if (stopped) return
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
      attempt += 1
      timer = setTimeout(() => void connect(), delay)
    }

    void connect()
    return () => {
      stopped = true
      source?.close()
      if (timer) clearTimeout(timer)
    }
  }, [conversation, expired])

  return <Context.Provider value={{ events, state }}>{children}</Context.Provider>
}

export function useConversationEvents() {
  const value = useContext(Context)
  if (value === null) {
    throw new Error('useConversationEvents must be used inside ConversationEventsProvider')
  }
  return value
}
