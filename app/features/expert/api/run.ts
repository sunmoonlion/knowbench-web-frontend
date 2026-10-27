'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { z } from 'zod'

import {
  acceptedSchema,
  reviewSchema,
  runSchema,
  runStepDetailSchema,
  taskDataSchema,
} from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { getJson, seg, sendJson } from '@/lib/workbench/http'
import { workbenchKeys } from '@/lib/workbench/queries'

const runKey = (task: string) => ['workbench', 'run', task] as const

// 一件委托：委托单、现在在干什么、每一步的状态。`beat` 变了就重取（页面拿事件的条数当它）
export function useRun(task: string, beat: number) {
  return useQuery({
    queryKey: [...runKey(task), beat],
    queryFn: () => getJson(runSchema, `/api/workbench/tasks/${seg(task)}/steps`),
    placeholderData: (previous) => previous,
  })
}

// 一步的细节：每一次交回了什么、验收的每一条、过程
export function useRunStep(task: string, step: number | null, beat: number) {
  return useQuery({
    queryKey: [...runKey(task), 'step', step, beat],
    queryFn: async () =>
      (await getJson(runStepDetailSchema, `/api/workbench/tasks/${seg(task)}/steps/${step}`)).step,
    enabled: step !== null,
    placeholderData: (previous) => previous,
  })
}

// 专家停下来问我的那件事：为什么停、哪几条没过、每个选项选了会怎样
export function useReview(pending: string | null) {
  return useQuery({
    queryKey: ['workbench', 'review', pending],
    queryFn: async () =>
      (await getJson(reviewSchema, `/api/workbench/interactions/${seg(pending!)}`)).interaction,
    enabled: pending !== null,
  })
}

// 这件委托用的数据（清单 v2 的专家，SDD 0043）：钉了哪几份、在等哪几项、专家新要了什么
export function useTaskData(task: string, beat: number) {
  return useQuery({
    queryKey: [...runKey(task), 'data', beat],
    queryFn: () => getJson(taskDataSchema, `/api/workbench/tasks/${seg(task)}/data`),
    placeholderData: (previous) => previous,
  })
}

const dataRequestSchema = z.object({ status: z.string() }).loose()

export function useRunActions(task: string) {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  const changed = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: runKey(task) }),
      client.invalidateQueries({ queryKey: ['workbench', 'conversation'] }),
      client.invalidateQueries({ queryKey: ['workbench', 'project'] }),
      client.invalidateQueries({ queryKey: workbenchKeys.conversations }),
      client.invalidateQueries({ queryKey: workbenchKeys.pending }),
    ])
  return {
    // 停下专家：正在做的那一步立刻停，不等它做完
    stop: useMutation({
      mutationFn: () =>
        sendJson(acceptedSchema, `/api/workbench/tasks/${seg(task)}/cancel`, { csrfToken }),
      onSuccess: changed,
    }),
    // 专家运行中新要的数据（0048 第五节）：确认了就去签、去取；不要的照现有的接着做
    confirmData: useMutation({
      mutationFn: () =>
        sendJson(dataRequestSchema, `/api/workbench/tasks/${seg(task)}/data-requests/confirm`, {
          csrfToken,
        }),
      onSuccess: changed,
    }),
    declineData: useMutation({
      mutationFn: () =>
        sendJson(dataRequestSchema, `/api/workbench/tasks/${seg(task)}/data-requests/decline`, {
          csrfToken,
        }),
      onSuccess: changed,
    }),
    answer: useMutation({
      mutationFn: (input: {
        pending: string
        token: string
        decision: string
        answer?: Record<string, unknown>
      }) =>
        sendJson(acceptedSchema, `/api/workbench/interactions/${seg(input.pending)}/respond`, {
          csrfToken,
          body: {
            token: input.token,
            decision: input.decision,
            ...(input.answer ? { answer: input.answer } : {}),
          },
        }),
      onSuccess: changed,
    }),
  }
}
