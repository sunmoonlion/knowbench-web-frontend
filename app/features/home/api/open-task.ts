'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { z } from 'zod'

import { useWorkbench } from '@/lib/workbench/context'
import { getJson, seg } from '@/lib/workbench/http'
import { routes } from '@/lib/workbench/routes'

// 别的应用带回来时地址上带 `?ref=<委托编号>`（例如去 knowbase 直达上传、传完回来）：
// 打开那件委托所在的对话。编号只认 UUID 的样子，委托是不是他的由后端核。
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const taskWhereSchema = z
  .object({
    task: z
      .object({ project_id: z.string().nullable().optional(), session_id: z.string() })
      .loose(),
  })
  .loose()

export function taskIdOf(ref: string | null): string | null {
  return ref !== null && TASK_ID.test(ref) ? ref : null
}

export function useOpenTaskFromRef(ref: string | null) {
  const router = useRouter()
  const { locale } = useWorkbench()
  const task = taskIdOf(ref)
  const found = useQuery({
    queryKey: ['workbench', 'task-where', task] as const,
    queryFn: () => getJson(taskWhereSchema, `/api/workbench/tasks/${seg(task!)}`),
    enabled: task !== null,
    retry: false,
  })
  const where = found.data?.task
  useEffect(() => {
    if (!where?.project_id) return
    router.replace(routes.projectConversation(locale, where.project_id, where.session_id))
  }, [where, locale, router])
}
