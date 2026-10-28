'use client'

// 请专家：专家清单与交给专家。放在 lib 里，首页的对话框和专家页都用它（功能之间不互相引用）。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { delegatedSchema, listedNeedsSchema, packsSchema } from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { getJson, seg, sendJson } from '@/lib/workbench/http'
import { workbenchKeys } from '@/lib/workbench/queries'

export function usePacks() {
  return useQuery({
    queryKey: ['workbench', 'expert', 'packs'],
    queryFn: async () => (await getJson(packsSchema, '/api/workbench/packs')).packs,
  })
}

// 这位专家用什么数据：清单 v2 的专家（SDD 0043）回 contract 与自带几份，要什么数据开跑后
// 由第 0 步按问题提出（decisions ⑭），这里不用选；内置专家不用数据（contract 是 null）
export function useDataNeeds(expert: string | null) {
  return useQuery({
    queryKey: ['workbench', 'expert', 'data-needs', expert],
    enabled: expert !== null,
    queryFn: () => getJson(listedNeedsSchema, `/api/workbench/packs/${seg(expert!)}/data-needs`),
  })
}

// 交给专家。从专家入口来：新建一段工作对话并立刻交出，一次提交；从对话里来：交出那段对话。
export function useAsk() {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      project: string
      from: string | null
      expert: string
      question: string
      // 同一次请求重发不会交出两次
      key: string
    }) => {
      if (input.from) {
        await sendJson(delegatedSchema, `/api/workbench/sessions/${seg(input.from)}/handover`, {
          csrfToken,
          body: {
            idempotency_key: input.key,
            profile_id: input.expert,
            original_input: { text: input.question },
          },
        })
        return { conversation: input.from }
      }
      const made = await sendJson(
        delegatedSchema,
        `/api/workbench/projects/${seg(input.project)}/delegations`,
        {
          csrfToken,
          body: {
            idempotency_key: input.key,
            expert: input.expert,
            question: input.question,
          },
        },
      )
      return { conversation: made.session_id ?? null }
    },
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: workbenchKeys.conversations }),
        client.invalidateQueries({ queryKey: ['workbench', 'expert'] }),
        client.invalidateQueries({ queryKey: ['workbench', 'conversation'] }),
      ]),
  })
}
