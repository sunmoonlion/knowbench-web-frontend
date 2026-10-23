import { describe, expect, it } from 'vitest'

import { linkSide } from '@/lib/workbench/link-side'

const A = '0f8fad5b-d9cb-469f-a165-70867728950e'
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const here = (device_id?: string) => ({
  agent: 'sunmoon-agent',
  version: '0.5.2',
  machine_name: 'pc',
  connected: true,
  ...(device_id ? { device_id } : {}),
})

describe('装有本地 link 的电脑还是远程登录 link 的电脑（会合点备忘第十一节，账 165）', () => {
  it('甲 = 乙：装有本地 link 的电脑', () => {
    expect(linkSide(here(A), { device_id: A })).toBe('local')
  })
  it('甲拿不到、或甲 ≠ 乙：远程登录 link 的电脑', () => {
    expect(linkSide(null, { device_id: A })).toBe('remote')
    expect(linkSide(here(B), { device_id: A })).toBe('remote')
  })
  it('比不了编号（老版本本地 link、后端还不知道乙）：先试回环口', () => {
    expect(linkSide(here(), { device_id: A })).toBe('try-local')
    expect(linkSide(here(A), null)).toBe('try-local')
    expect(linkSide(here(A), { device_id: null })).toBe('try-local')
  })
  it('还没探完、或还没问到后端：先等', () => {
    expect(linkSide(undefined, { device_id: A })).toBeUndefined()
    expect(linkSide(here(A), undefined)).toBeUndefined()
  })
})
