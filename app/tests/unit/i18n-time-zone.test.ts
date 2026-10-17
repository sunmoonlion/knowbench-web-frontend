import { describe, expect, it, vi } from 'vitest'

import requestConfig, { TIME_ZONE } from '@/i18n'

// 测试跑在浏览器环境里，next-intl 的服务端入口不让用；这里只要配置函数本身
vi.mock('next-intl/server', () => ({ getRequestConfig: (make: unknown) => make }))

describe('time zone', () => {
  it('renders times in Beijing time, not the server clock (ledger 131)', async () => {
    const config = await requestConfig({ requestLocale: Promise.resolve('zh-CN') } as never)
    expect(config.timeZone).toBe('Asia/Shanghai')
    const at = new Intl.DateTimeFormat('zh-CN', {
      timeZone: TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date('2026-10-17T15:08:00Z'))
    expect(at).toBe('23:08')
  })
})
