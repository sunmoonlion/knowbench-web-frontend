// 打开工作台时的核对（会合点备忘第五节，账 143）：比编号甲（这台电脑上的本地 link 自己报的）和乙（配给当前账号的
// 那份，后端记着），再看沙箱就绪没有。只在要用户做事时给提示，一切正常不提示；侧栏不挂这类状态。
import type { Presence } from '@/lib/workbench/local-agent'

export type LinkPrompt =
  | { kind: 'token_invalid' }
  | { kind: 'unreachable' }
  | { kind: 'version_mismatch' }
  | { kind: 'not_this_computer' }
  | { kind: 'no_local_link'; name: string | null }
  | { kind: 'copied'; first: string; host: string }
export type SandboxPrompt = { kind: 'no_key' } | { kind: 'sandbox_not_ready' }
// 这台就是装有本地 link 的电脑、而它的 Codex 命令隔离是普通模式（拦写不拦删）：提示到托盘里提高
export type IsolationPrompt = { kind: 'weak_isolation' }

export type Assigned = {
  name: string
  device_id?: string | null
  host?: string | null
  first_host?: string | null
}

export type LinkCheckInput = {
  // undefined = 还没探完；null = 探过了，这台设备上没有在运行的本地 link，或浏览器不让探
  presence: Presence | null | undefined
  // undefined = 还没问到后端；null = 还没有哪份报过编号的本地 link 配给这个账号
  assigned: Assigned | null | undefined
  copied: boolean | undefined
  sandboxReady: boolean | undefined
  hasKey: boolean | undefined
}

export function linkCheck(input: LinkCheckInput): {
  link: LinkPrompt | null
  sandbox: SandboxPrompt | null
  isolation: IsolationPrompt | null
} {
  return {
    link: linkPrompt(input),
    sandbox: sandboxPrompt(input),
    isolation: isolationPrompt(input),
  }
}

function linkPrompt({ presence, assigned, copied }: LinkCheckInput): LinkPrompt | null {
  if (presence === undefined || assigned === undefined) return null
  // 甲拿不到（没装、没在运行、手机、浏览器不让探）：一行小字，不强迫
  if (presence === null) return { kind: 'no_local_link', name: assigned?.name ?? null }
  // 0.5.2 之前的本地 link 不报编号：比不了，宁可不说也不误报
  if (!presence.device_id) return null
  const state = presence.link_state
  if (assigned === null || !assigned.device_id) {
    return state === 'token_invalid' ? { kind: 'token_invalid' } : null
  }
  // 甲 ≠ 乙：这台的本地 link 配给了别的账号，或从没给这个账号颁发过令牌
  if (assigned.device_id !== presence.device_id || state === 'replaced') {
    return { kind: 'not_this_computer' }
  }
  if (copied && assigned.first_host && assigned.host) {
    return { kind: 'copied', first: assigned.first_host, host: assigned.host }
  }
  if (state === 'token_invalid') return { kind: 'token_invalid' }
  if (state === 'version_mismatch') return { kind: 'version_mismatch' }
  // 在运行却连不上会合点（网断了、卡住）：叫检查网络或重开，不叫重新颁发
  if (state === 'unreachable' || state === 'rejected') return { kind: 'unreachable' }
  return null
}

// 只在甲 = 乙时说：在别的电脑上看到也做不了什么（要在那台电脑的托盘里点）
function isolationPrompt({ presence, assigned }: LinkCheckInput): IsolationPrompt | null {
  if (!presence?.device_id || !assigned?.device_id || presence.device_id !== assigned.device_id)
    return null
  return presence.windows_sandbox === 'unelevated' ? { kind: 'weak_isolation' } : null
}

function sandboxPrompt({ sandboxReady, hasKey }: LinkCheckInput): SandboxPrompt | null {
  if (hasKey === false) return { kind: 'no_key' }
  if (hasKey === true && sandboxReady === false) return { kind: 'sandbox_not_ready' }
  return null
}
