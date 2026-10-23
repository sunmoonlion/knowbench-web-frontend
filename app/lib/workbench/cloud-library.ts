'use client'

// 云端知识库的清单（SDD 0042）：知识库页和请专家时选数据的弹框都用，同一份缓存。
import { useQuery } from '@tanstack/react-query'

import { cloudListSchema } from '@/contracts/workbench-v2'
import { getJson } from '@/lib/workbench/http'

export const cloudLibraryKey = ['workbench', 'cloud-library'] as const

export function useCloudLibrary() {
  return useQuery({
    queryKey: cloudLibraryKey,
    queryFn: async () => (await getJson(cloudListSchema, '/api/workbench/cloud-library')).items,
    retry: false,
  })
}
