'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import {
  createdConversationSchema,
  type ConversationKind,
} from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { useTurnSender } from '@/lib/workbench/conversation'
import { sendJson } from '@/lib/workbench/http'
import { workbenchKeys } from '@/lib/workbench/queries'

// 开始一段对话：建对话，再把第一句话发出去。
export function useStart() {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  const send = useTurnSender()
  // 第一条消息被明确拒绝后仍用已建的会话，避免每点一次重试就留下一个空会话。
  const pending = useRef<{ kind: ConversationKind; project: string | null; id: string } | null>(
    null,
  )
  return useMutation({
    mutationFn: async (input: { kind: ConversationKind; project: string | null; text: string }) => {
      if (
        !pending.current ||
        pending.current.kind !== input.kind ||
        pending.current.project !== input.project
      ) {
        const made = await sendJson(createdConversationSchema, '/api/workbench/sessions', {
          csrfToken,
          body: { kind: input.kind, ...(input.project ? { project_id: input.project } : {}) },
        })
        pending.current = { id: made.session_id, project: input.project, kind: input.kind }
      }
      const id = pending.current.id
      await send(id, input.text)
      pending.current = null
      return { id, project_id: input.project, kind: input.kind }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: workbenchKeys.conversations }),
  })
}
