'use client'

// 这段对话选用的云端知识库（SDD 0042 第四节）：聊天页、工作页的输入框旁都用。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { sessionCloudDataSchema } from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { getJson, seg, sendJson } from '@/lib/workbench/http'

const key = (session: string | null) => ['workbench', 'session-cloud-data', session] as const

export function useSessionCloudData(session: string | null) {
  return useQuery({
    queryKey: key(session),
    enabled: session !== null,
    queryFn: () =>
      getJson(sessionCloudDataSchema, `/api/workbench/sessions/${seg(session!)}/cloud-data`),
    retry: false,
  })
}

// 换成这几份（空的就是不用了）；后端核过、签好授权才回
export function useChooseSessionCloudData(session: string | null) {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (items: string[]) =>
      sendJson(sessionCloudDataSchema, `/api/workbench/sessions/${seg(session!)}/cloud-data`, {
        csrfToken,
        method: 'PUT',
        body: { items },
      }),
    onSuccess: (data) => client.setQueryData(key(session), data),
  })
}
