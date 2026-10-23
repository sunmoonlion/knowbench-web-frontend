// 浏览器所在的这台是装有本地 link 的电脑，还是远程登录 link 的电脑（会合点备忘第十一节，账 165）：比编号甲
// （本机本地 link 自己报的）和乙（配给当前账号的那份）。和工作台顶上的核对共用同一次探测。
import type { Presence } from './local-agent'

// local：直连回环口；remote：走工作台转发；try-local：比不了编号（0.5.2 之前的本地 link 不报，或后端还不知道乙），
// 先试回环口，本机本地 link 配给的不是当前账号、或这台没有，再走远程；undefined：还没探完，先等
export type LinkSide = 'local' | 'remote' | 'try-local'

export function linkSide(
  presence: Presence | null | undefined,
  assigned: { device_id?: string | null } | null | undefined,
): LinkSide | undefined {
  if (presence === undefined) return undefined
  if (presence === null) return 'remote'
  if (!presence.device_id) return 'try-local'
  if (assigned === undefined) return undefined
  if (!assigned?.device_id) return 'try-local'
  return assigned.device_id === presence.device_id ? 'local' : 'remote'
}
