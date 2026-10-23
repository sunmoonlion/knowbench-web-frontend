'use client'

import { useSandboxStatus } from '@/lib/workbench/queries'

// 引导与令牌面板共享只读状态；页面刷新不会签发或轮换身份。和工作台顶上的核对共用 lib 里那一份（账 143）
export function useAgentStatus() {
  return useSandboxStatus()
}
