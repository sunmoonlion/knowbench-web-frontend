'use client'

import { useQuery } from '@tanstack/react-query'

import { boardSchema } from '@/contracts/workbench-v2'
import { getJson, seg } from '@/lib/workbench/http'

// 项目的看板：委托按列，卡片写清等谁、等什么（请专家方案设计第 4.8 节）。隔一会儿重取一次
export function useBoard(project: string, enabled: boolean) {
  return useQuery({
    queryKey: ['workbench', 'project', project, 'board'],
    queryFn: () => getJson(boardSchema, `/api/workbench/projects/${seg(project)}/board`),
    enabled,
    refetchInterval: 15_000,
  })
}
