'use client'

// 请自己的分身（SDD 0027 P4）：从 knowmart 选定回来，交给后端按会话核验并钉住。
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { acceptedSchema, pinnedKnowbotSchema } from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { seg, sendJson } from '@/lib/workbench/http'

// knowmart 回跳带回来的 `<分身>@<版本>`；不合规则当作没带
export const KNOWBOT_REF =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@[1-9][0-9]{0,5}$/

export function usePinKnowbot() {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (knowbot: string) =>
      (
        await sendJson(pinnedKnowbotSchema, '/api/workbench/knowbots/pin', {
          csrfToken,
          body: { knowbot },
        })
      ).pack,
    onSuccess: () => client.invalidateQueries({ queryKey: ['workbench', 'expert', 'packs'] }),
  })
}

// 移除当前用户列表中的专家；服务端保留版本快照和历史任务。
export function useRemoveExpert() {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      sendJson(acceptedSchema, `/api/workbench/packs/${seg(id)}`, {
        csrfToken,
        method: 'DELETE',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['workbench', 'expert', 'packs'] }),
  })
}
