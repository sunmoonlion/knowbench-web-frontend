'use client'

// 请专家：专家清单与交给专家。放在 lib 里，首页的对话框和专家页都用它（功能之间不互相引用）。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { z } from 'zod'

import {
  type DataChoice,
  dataNeedsSchema,
  dataPlanSchema,
  delegatedSchema,
  listedNeedsSchema,
  packsSchema,
} from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { getJson, seg, sendJson } from '@/lib/workbench/http'
import { workbenchKeys } from '@/lib/workbench/queries'

export function usePacks() {
  return useQuery({
    queryKey: ['workbench', 'expert', 'packs'],
    queryFn: async () => (await getJson(packsSchema, '/api/workbench/packs')).packs,
  })
}

// 这位专家要你提供哪些数据（数据需求声明，SDD 0042），和同一项目上次选的那几份（默认选上）。
// 内置专家、旧格式的专家没有声明：needs 是空的。清单 v2 的专家（SDD 0043）回 contract：
// 页面改走「填主体 → 列清单」
const needsOf = z.union([
  listedNeedsSchema.transform((got) => ({ kind: 'v2' as const, ...got })),
  dataNeedsSchema.transform((got) => ({ kind: 'v1' as const, ...got })),
])
export function useDataNeeds(expert: string | null, project: string) {
  return useQuery({
    queryKey: ['workbench', 'expert', 'data-needs', expert, project],
    enabled: expert !== null,
    queryFn: () =>
      getJson(
        needsOf,
        `/api/workbench/packs/${seg(expert!)}/data-needs?project_id=${encodeURIComponent(project)}`,
      ),
  })
}

// 清单 v2 的专家开跑前列出：knowbase 按声明与主体解析，每一样用哪份、为什么
export function useDataPlan() {
  const { csrfToken } = useWorkbench()
  return useMutation({
    mutationFn: (input: { expert: string; subjects: string[] }) =>
      sendJson(dataPlanSchema, `/api/workbench/packs/${seg(input.expert)}/data-plan`, {
        csrfToken,
        body: { subjects: input.subjects },
      }),
  })
}

// 在清单上的选择：换过的（条目编号 → 资料与版本）、去掉的可选条目
export type ListedChoice = {
  resolution_id: string
  revision: number
  picks: Record<string, { material_id: string; version_no: number }>
  dropped: string[]
}

// 请求里的数据只带认得的字段（名字只给页面看）
const sent = (data: DataChoice[] | undefined) =>
  (data ?? []).map(({ need, source, item_id, path }) =>
    source === 'cloud' ? { need, source, item_id } : { need, source, path },
  )

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
      // 专家写了数据需求声明时按声明选的数据
      data?: DataChoice[]
      // 清单 v2 的专家：在清单上的选择（待确认的随请专家一并确认）
      dataV2?: ListedChoice | null
    }) => {
      const data = sent(input.data)
      const listed = input.dataV2 ? { data_v2: input.dataV2 } : {}
      if (input.from) {
        await sendJson(delegatedSchema, `/api/workbench/sessions/${seg(input.from)}/handover`, {
          csrfToken,
          body: {
            idempotency_key: input.key,
            profile_id: input.expert,
            original_input: { text: input.question },
            ...(data.length ? { data } : {}),
            ...listed,
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
            ...(data.length ? { data } : {}),
            ...listed,
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
