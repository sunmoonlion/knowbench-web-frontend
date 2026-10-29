'use client'

// AI 请专家（请专家方案设计第 4.9 节；decisions 10-29「AI 请专家」）：在用户的项目里用他自己的模型
// 跑一轮「找专家」，按结果直接请（不用另付钱的）、给他看候选（要付钱的）、或都不合适时给两件事做。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createdConversationSchema,
  demandPublishedSchema,
  findResultSchema,
  findStartedSchema,
  incubationAskedSchema,
  turnAcceptedSchema,
} from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { getJson, seg, sendJson } from '@/lib/workbench/http'
import { workbenchKeys } from '@/lib/workbench/queries'

const POLL_MS = 3000
const DONE = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED'])

export function useStartFind() {
  const { csrfToken } = useWorkbench()
  return useMutation({
    mutationFn: (input: { project: string; question: string; key: string }) =>
      sendJson(findStartedSchema, `/api/workbench/projects/${seg(input.project)}/find-expert`, {
        csrfToken,
        body: { idempotency_key: input.key, question: input.question },
      }),
  })
}

// 这一轮的结果：没结束就每 3 秒问一次
export function useFindResult(task: string | null) {
  return useQuery({
    queryKey: ['workbench', 'find-expert', task],
    enabled: task !== null,
    queryFn: () => getJson(findResultSchema, `/api/workbench/find-expert/${seg(task!)}`),
    refetchInterval: (query) =>
      query.state.data && DONE.has(query.state.data.state) ? false : POLL_MS,
  })
}

export function usePublishDemand(task: string) {
  const { csrfToken } = useWorkbench()
  return useMutation({
    mutationFn: (demand: { title: string; problem: string }) =>
      sendJson(demandPublishedSchema, `/api/workbench/find-expert/${seg(task)}/demand`, {
        csrfToken,
        body: demand,
      }),
  })
}

export function useAskIncubation(task: string) {
  const { csrfToken } = useWorkbench()
  return useMutation({
    mutationFn: (conversation: string | null) =>
      sendJson(incubationAskedSchema, `/api/workbench/find-expert/${seg(task)}/incubation`, {
        csrfToken,
        body: conversation ? { conversation_id: conversation } : {},
      }),
  })
}

// 「让我的模型直接答」：项目里一段聊天（记来源 direct_answer），把问题发出去
export function useDirectAnswer() {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: { project: string; question: string; task: string }) => {
      const made = await sendJson(createdConversationSchema, '/api/workbench/sessions', {
        csrfToken,
        body: { kind: 'chat', project_id: input.project, origin: 'direct_answer' },
      })
      await sendJson(turnAcceptedSchema, `/api/workbench/sessions/${seg(made.session_id)}/turns`, {
        csrfToken,
        body: { text: input.question },
      })
      remember(DIRECT, made.session_id, { task: input.task })
      return made.session_id
    },
    onSuccess: () => client.invalidateQueries({ queryKey: workbenchKeys.conversations }),
  })
}

// 浏览器里记两样，给后面的页面用：直接答的那段对话是哪一轮找专家来的（聊天页上好接着点「孵化」）；
// AI 替用户请了哪位、理由（专家处理中那一页顶上照实写）。记在这个浏览器里（关了标签页也在），
// 换了浏览器就没有；取不到就当没有。
const DIRECT = 'workbench.directAnswer.'
const SUMMONED = 'workbench.aiSummoned.'

function remember(prefix: string, conversation: string, value: unknown) {
  try {
    window.localStorage.setItem(prefix + conversation, JSON.stringify(value))
  } catch {
    // 浏览器不让存：页面照常，只是少一句说明
  }
}

function recall<T>(prefix: string, conversation: string): T | null {
  try {
    const raw = window.localStorage.getItem(prefix + conversation)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export const directAnswerOf = (conversation: string) =>
  recall<{ task: string }>(DIRECT, conversation)

export const rememberSummoned = (conversation: string, value: { name: string; reason: string }) =>
  remember(SUMMONED, conversation, value)

export const summonedOf = (conversation: string) =>
  recall<{ name: string; reason: string }>(SUMMONED, conversation)
