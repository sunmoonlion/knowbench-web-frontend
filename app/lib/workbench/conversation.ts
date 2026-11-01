'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  acceptedSchema,
  conversationViewSchema,
  turnAcceptedSchema,
} from '@/contracts/workbench-v2'
import { useWorkbench } from './context'
import { getJson, seg, sendJson } from './http'
import { workbenchKeys } from './queries'

const base = (conversation: string) => `/api/workbench/sessions/${seg(conversation)}`
const key = (conversation: string) => ['workbench', 'conversation', conversation] as const

export function useConversation(conversation: string) {
  return useQuery({
    queryKey: key(conversation),
    queryFn: () => getJson(conversationViewSchema, base(conversation)),
    select: (view) => view.session,
  })
}

// 这段对话里等着用户答复的事（同一次请求，不另取）
export function useWaiting(conversation: string) {
  return useQuery({
    queryKey: key(conversation),
    queryFn: () => getJson(conversationViewSchema, base(conversation)),
    select: (view) => view.pending_interactions,
  })
}

// 这段对话上能做的动作。做完让受影响的清单重取。
export function useConversationActions(conversation: string) {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  const changed = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: key(conversation) }),
      client.invalidateQueries({ queryKey: workbenchKeys.conversations }),
    ])
  }
  return {
    say: useMutation({
      mutationFn: (text: string) =>
        sendJson(turnAcceptedSchema, `${base(conversation)}/turns`, { csrfToken, body: { text } }),
      onSuccess: changed,
    }),
    // 不用说停哪一轮：停的是这段对话正在跑的那一轮
    stop: useMutation({
      mutationFn: () => sendJson(acceptedSchema, `${base(conversation)}/interrupt`, { csrfToken }),
    }),
    cancelQueuedTask: useMutation({
      mutationFn: (task: string) =>
        sendJson(acceptedSchema, `/api/workbench/tasks/${seg(task)}/cancel`, { csrfToken }),
      onSuccess: async () => {
        await changed()
        await client.invalidateQueries({ queryKey: ['workbench', 'project'] })
      },
    }),
    rename: useMutation({
      mutationFn: (title: string) =>
        sendJson(acceptedSchema, base(conversation), {
          csrfToken,
          method: 'PATCH',
          body: { title },
        }),
      onSuccess: changed,
    }),
    putInProject: useMutation({
      mutationFn: (project: string) =>
        sendJson(acceptedSchema, `${base(conversation)}/project`, {
          csrfToken,
          body: { project_id: project },
        }),
      onSuccess: changed,
    }),
    // 答复一件等着的事（批准或拒绝一条命令）。凭证在「开了这件待办」的那条事件里
    answer: useMutation({
      mutationFn: (input: {
        pending: string
        token: string
        decision: string
        answer?: Record<string, unknown>
      }) =>
        sendJson(acceptedSchema, `/api/workbench/interactions/${seg(input.pending)}/respond`, {
          csrfToken,
          body: {
            token: input.token,
            decision: input.decision,
            ...(input.answer ? { answer: input.answer } : {}),
          },
        }),
      onSuccess: async () => {
        await changed()
        await client.invalidateQueries({ queryKey: workbenchKeys.pending })
      },
    }),
    turnIntoWork: useMutation({
      mutationFn: () =>
        sendJson(acceptedSchema, `${base(conversation)}/kind`, {
          csrfToken,
          body: { kind: 'work' },
        }),
      onSuccess: changed,
    }),
  }
}
