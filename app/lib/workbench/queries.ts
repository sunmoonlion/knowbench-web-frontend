'use client'

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import {
  conversationsSchema,
  localLinkSchema,
  machinesSchema,
  pendingListSchema,
  projectDetailSchema,
  projectsSchema,
  sandboxesSchema,
  tasksSchema,
  workspacesSchema,
} from '@/contracts/workbench-v2'
import { credentialSchema, provisionedSandboxSchema } from '@/contracts/workbench-settings'
import { getJson, seg } from './http'
import {
  connectLocalAgent,
  probeLocalAgent,
  readDirectory,
  readFile,
  readSettings,
  type LocalAgent,
} from './local-agent'

// 好几个功能都要的清单：工作区、项目、对话、待办、机器、沙箱。
// 键都以 'workbench' 开头：哪个功能改了东西，按键让别处重取。
export const workbenchKeys = {
  workspaces: ['workbench', 'workspaces'] as const,
  projects: ['workbench', 'projects'] as const,
  conversations: ['workbench', 'conversations'] as const,
  pending: ['workbench', 'pending'] as const,
  machines: ['workbench', 'machines'] as const,
  sandboxes: ['workbench', 'sandboxes'] as const,
  // 代理服务流（0022）：按电脑、按路径
  agentService: (environment: string) => ['workbench', 'agent', environment, 'service'] as const,
  directory: (environment: string, path: string) =>
    ['workbench', 'agent', environment, 'dir', path] as const,
  file: (environment: string, path: string) =>
    ['workbench', 'agent', environment, 'file', path] as const,
  // 一段对话里请过的专家，带各次的底稿位置
  tasks: (conversation: string) => ['workbench', 'tasks', conversation] as const,
}

export function useConversationTasks(conversation: string | null) {
  return useQuery({
    queryKey: workbenchKeys.tasks(conversation ?? ''),
    enabled: Boolean(conversation),
    queryFn: async () =>
      (
        await getJson(
          tasksSchema,
          `/api/workbench/tasks?session_id=${encodeURIComponent(conversation ?? '')}`,
        )
      ).tasks,
  })
}

export function useWorkspaces() {
  return useQuery({
    queryKey: workbenchKeys.workspaces,
    queryFn: async () => (await getJson(workspacesSchema, '/api/workbench/workspaces')).workspaces,
  })
}

export function useProjects() {
  return useQuery({
    queryKey: workbenchKeys.projects,
    queryFn: async () => (await getJson(projectsSchema, '/api/workbench/projects')).projects,
  })
}

export function useConversations() {
  return useQuery({
    queryKey: workbenchKeys.conversations,
    queryFn: async () => (await getJson(conversationsSchema, '/api/workbench/sessions')).sessions,
  })
}

export function usePending() {
  return useQuery({
    queryKey: workbenchKeys.pending,
    queryFn: async () =>
      (await getJson(pendingListSchema, '/api/workbench/interactions')).interactions,
  })
}

export function useMachines(refetchInterval: number | false = false) {
  return useQuery({
    queryKey: workbenchKeys.machines,
    refetchInterval,
    queryFn: async () =>
      (await getJson(machinesSchema, '/api/workbench/environments')).environments,
  })
}

// 沙箱的状态（就绪没有）与登记过的模型 key：工作台顶上的核对与设置页共用同一份缓存（账 143）
export function useSandboxStatus() {
  return useQuery({
    queryKey: ['wb-provisioned'],
    queryFn: () => getJson(provisionedSandboxSchema, '/api/workbench/sandboxes/provisioned'),
    refetchInterval: 5000,
  })
}

export function useCredentials() {
  return useQuery({
    queryKey: ['wb-credentials'],
    queryFn: async () =>
      (
        await getJson(
          z.object({ credentials: z.array(credentialSchema) }),
          '/api/workbench/credentials',
        )
      ).credentials,
  })
}

// 配给当前账号的那份本地 link（账 143）：打开工作台时的核对和设置页「电脑与沙箱」都用
export function useLocalLink() {
  return useQuery({
    queryKey: ['workbench', 'local-link'] as const,
    queryFn: () => getJson(localLinkSchema, '/api/workbench/local-link'),
    refetchInterval: 15_000,
  })
}

export function useSandboxes() {
  return useQuery({
    queryKey: workbenchKeys.sandboxes,
    queryFn: async () => (await getJson(sandboxesSchema, '/api/workbench/sandboxes')).sandboxes,
  })
}

// 一个项目：它的对话、底稿、有没有专家正在做
export function useProjectDetail(project: string) {
  return useQuery({
    queryKey: ['workbench', 'project', project],
    queryFn: () => getJson(projectDetailSchema, `/api/workbench/projects/${seg(project)}`),
  })
}

// 全部项目。归档的默认不取
export function useAllProjects(includeArchived: boolean) {
  return useQuery({
    queryKey: ['workbench', 'projects', 'all', includeArchived],
    queryFn: async () =>
      (
        await getJson(
          projectsSchema,
          `/api/workbench/projects${includeArchived ? '?include_archived=true' : ''}`,
        )
      ).projects,
  })
}

// ---------------- 代理回环口（0022 乙案）：那台电脑上的文件，不经工作台 ----------------
// 探口、要票、问代理是谁，三步合成一个查询；失败的 code 由页面挑话说
export function useLocalAgent(environment: string | null) {
  return useQuery({
    queryKey: workbenchKeys.agentService(environment ?? ''),
    enabled: environment !== null,
    retry: false,
    staleTime: 30_000,
    queryFn: () => connectLocalAgent(environment!),
  })
}

export function useLocalDirectory(agent: LocalAgent | null, path: string | null) {
  return useQuery({
    queryKey: workbenchKeys.directory(agent?.info.userId ?? '', path ?? ''),
    enabled: agent !== null && path !== null,
    retry: false,
    staleTime: 5_000,
    queryFn: () => readDirectory(agent!, path!),
  })
}

export function useLocalFile(agent: LocalAgent | null, path: string | null) {
  return useQuery({
    queryKey: workbenchKeys.file(agent?.info.userId ?? '', path ?? ''),
    enabled: agent !== null && path !== null,
    retry: false,
    staleTime: 5_000,
    queryFn: () => readFile(agent!, path!),
  })
}

// 这台电脑上有没有在跑的代理（账 92）：页面加载探一次，一分钟内不重探；探不到不是错
export function useLocalPresence() {
  return useQuery({
    queryKey: ['workbench', 'local', 'presence'] as const,
    queryFn: () => probeLocalAgent(),
    retry: false,
    staleTime: 60_000,
  })
}

// 代理那头的设置（白名单、上限、自启、知识库目录），经回环口读
export function useLocalSettings(agent: LocalAgent | null) {
  return useQuery({
    queryKey: ['workbench', 'local', agent?.info.userId ?? '', 'settings'] as const,
    enabled: agent !== null,
    retry: false,
    staleTime: 5_000,
    queryFn: () => readSettings(agent!),
  })
}
