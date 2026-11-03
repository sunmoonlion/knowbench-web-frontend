import { describe, expect, it } from 'vitest'

import { destinations } from '@/lib/cross-app/destinations'

describe('where knowbench takes people', () => {
  it('to the owner’s own knowbots in knowmart and to direct upload in knowbase; public data entries live in the admin consoles', () => {
    // 2026-10-07 所有者定公共数据入口放管理后台；2026-10-16 定「请分身」跳到 knowmart 选（SDD 0027）；
    // 解析回「采不来」时去 knowbase 直达上传（SDD 0043 第 3.2 节、0044 第 2.4 节）
    expect(destinations).toEqual({
      'knowlab.createIdea': { target: 'knowlab', segments: ['applications', 'new'] },
      'knowmart.knowbots': { target: 'knowmart', segments: ['knowbots'] },
      'knowbase.upload': {
        target: 'knowbase',
        segments: ['upload'],
        params: ['doc_type', 'subject', 'period_start', 'period_end', 'disclosed_on', 'edition'],
      },
    })
  })
})
