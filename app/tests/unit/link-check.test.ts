import { describe, expect, it } from 'vitest'

import { linkCheck, type LinkCheckInput } from '@/features/shell/model/link-check'

const A = '0f8fad5b-d9cb-469f-a165-70867728950e'
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const here = (extra: object = {}) => ({
  agent: 'sunmoon-agent',
  version: '0.5.2',
  machine_name: 'pc',
  connected: true,
  device_id: A,
  link_state: 'connected' as const,
  ...extra,
})
const assigned = { name: 'pc', device_id: A, host: 'DESKTOP-A', first_host: 'DESKTOP-A' }
const ok: LinkCheckInput = {
  presence: here(),
  assigned,
  copied: false,
  sandboxReady: true,
  hasKey: true,
}

describe('打开工作台时的核对（会合点备忘第五节，账 143）', () => {
  it('甲 = 乙，本地 link 连着、沙箱就绪：不提示', () => {
    expect(linkCheck(ok)).toEqual({ link: null, sandbox: null, isolation: null })
  })
  it('还没探完或还没问到后端：先不说', () => {
    expect(linkCheck({ ...ok, presence: undefined }).link).toBeNull()
    expect(linkCheck({ ...ok, assigned: undefined }).link).toBeNull()
    expect(linkCheck({ ...ok, sandboxReady: undefined, hasKey: undefined }).sandbox).toBeNull()
  })
  it('甲 = 乙，令牌失效：令牌已失效 + 重新颁发', () => {
    expect(linkCheck({ ...ok, presence: here({ link_state: 'token_invalid' }) }).link).toEqual({
      kind: 'token_invalid',
    })
  })
  it('甲 = 乙，在运行但连不上会合点：检查网络或重开，不叫重新颁发', () => {
    for (const state of ['unreachable', 'rejected'] as const)
      expect(linkCheck({ ...ok, presence: here({ link_state: state }) }).link).toEqual({
        kind: 'unreachable',
      })
    expect(linkCheck({ ...ok, presence: here({ link_state: 'connecting' }) }).link).toBeNull()
    expect(linkCheck({ ...ok, presence: here({ link_state: 'version_mismatch' }) }).link).toEqual({
      kind: 'version_mismatch',
    })
  })
  it('甲 ≠ 乙，或这台被别的本地 link 顶掉：工作台现在用的不是这台电脑', () => {
    expect(linkCheck({ ...ok, presence: here({ device_id: B }) }).link).toEqual({
      kind: 'not_this_computer',
    })
    expect(linkCheck({ ...ok, presence: here({ link_state: 'replaced' }) }).link).toEqual({
      kind: 'not_this_computer',
    })
  })
  it('甲拿不到：一行小字，写出工作台现在用的电脑名；没有配给的就不写名字', () => {
    expect(linkCheck({ ...ok, presence: null }).link).toEqual({ kind: 'no_local_link', name: 'pc' })
    expect(linkCheck({ ...ok, presence: null, assigned: null }).link).toEqual({
      kind: 'no_local_link',
      name: null,
    })
  })
  it('老版本本地 link 不报编号：比不了，不误报', () => {
    expect(
      linkCheck({ ...ok, presence: here({ device_id: undefined, link_state: undefined }) }).link,
    ).toBeNull()
  })
  it('后端还没有带编号的本地 link：只在令牌失效时说', () => {
    expect(linkCheck({ ...ok, assigned: null }).link).toBeNull()
    expect(
      linkCheck({ ...ok, assigned: null, presence: here({ link_state: 'token_invalid' }) }).link,
    ).toEqual({ kind: 'token_invalid' })
  })
  it('配置像是从别的电脑拷来的：照实说两个主机名', () => {
    expect(
      linkCheck({ ...ok, copied: true, assigned: { ...assigned, host: 'DESKTOP-B' } }).link,
    ).toEqual({ kind: 'copied', first: 'DESKTOP-A', host: 'DESKTOP-B' })
  })
  it('沙箱：没登记 key 先登记；登记了却没就绪就说没就绪', () => {
    expect(linkCheck({ ...ok, hasKey: false, sandboxReady: false }).sandbox).toEqual({
      kind: 'no_key',
    })
    expect(linkCheck({ ...ok, sandboxReady: false }).sandbox).toEqual({ kind: 'sandbox_not_ready' })
  })
})

describe('Codex 命令隔离是普通模式时的提示（SDD 0041 第四节）', () => {
  it('甲 = 乙且报普通模式：提示到托盘里提高；提权模式或老版本不报：不提示', () => {
    expect(
      linkCheck({ ...ok, presence: here({ windows_sandbox: 'unelevated' }) }).isolation,
    ).toEqual({
      kind: 'weak_isolation',
    })
    expect(
      linkCheck({ ...ok, presence: here({ windows_sandbox: 'elevated' }) }).isolation,
    ).toBeNull()
    expect(linkCheck(ok).isolation).toBeNull()
  })
  it('甲 ≠ 乙、探不到、还没配给：不提示（在别的电脑上做不了）', () => {
    const weak = here({ windows_sandbox: 'unelevated' })
    expect(linkCheck({ ...ok, presence: { ...weak, device_id: B } }).isolation).toBeNull()
    expect(linkCheck({ ...ok, presence: null }).isolation).toBeNull()
    expect(linkCheck({ ...ok, presence: weak, assigned: null }).isolation).toBeNull()
  })
})
