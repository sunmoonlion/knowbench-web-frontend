'use client'

export { useAsk, useDataNeeds, usePacks } from '@/lib/workbench/expert-desk'

import { useQuery } from '@tanstack/react-query'

import { eventsPageSchema, overviewSchema, reviewPlaceSchema } from '@/contracts/workbench-v2'
import { getJson, seg } from '@/lib/workbench/http'
import { text } from '@/lib/workbench/items'

// 专家首页：等我决定的、进行中的、最近交回的
export function useOverview() {
  return useQuery({
    queryKey: ['workbench', 'expert', 'overview'],
    queryFn: () => getJson(overviewSchema, '/api/workbench/expert/overview'),
  })
}

// 有哪些专家。给的是名字、白话、每一步的名字与不过时怎么办；没有方法的原文

// 从一段对话里请专家：带入那段对话里用户最近说的一句，并数一数说了几轮
export function useSaid(conversation: string | null) {
  return useQuery({
    queryKey: ['workbench', 'said', conversation],
    enabled: conversation !== null,
    queryFn: async () => {
      const page = await getJson(
        eventsPageSchema,
        `/api/workbench/sessions/${seg(conversation!)}/events?limit=1000`,
      )
      const said = page.events.filter((event) => event.type === 'turn/requested')
      return { turns: said.length, last: text(said[said.length - 1]?.payload.text) }
    },
  })
}

// 这件待办在哪：哪个项目、哪段对话（单独的审查面要用）
export function useReviewPlace(pending: string) {
  return useQuery({
    queryKey: ['workbench', 'review-place', pending],
    queryFn: async () =>
      (await getJson(reviewPlaceSchema, `/api/workbench/interactions/${seg(pending)}`)).interaction,
  })
}
