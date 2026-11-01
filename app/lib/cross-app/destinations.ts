import { defineDestinations } from '@/lib/cross-app/links'

// knowbench 会把用户带去的页面，都登记在这里（PRD/apps/README.md 4.1）。
// 2026-10-07 所有者定：公共数据的入口（数据目录、申请入库）不在用户侧，放管理后台。
export const destinations = defineDestinations({
  // 「请我的分身」：去 knowmart「我的分身」选一位，选定后 knowmart 按登记的回跳地址带回工作台，
  // 链接上只多 knowbot=<分身>@<版本>（SDD 0027 P4）。回来后由后端按会话向 knowmart 核验
  'knowmart.knowbots': { target: 'knowmart', segments: ['knowbots'] },
  // 「采不来，要本人到 knowbase 上传」：去 knowbase 直达上传（SDD 0043 第 3.2 节、0044 第 2.4 节），
  // 按那一样的描述预填；ref 是委托编号，传完 knowbase 按自己配置的回跳地址带回来
  'knowbase.upload': {
    target: 'knowbase',
    segments: ['upload'],
    params: ['doc_type', 'subject', 'period_start', 'period_end', 'disclosed_on', 'edition'],
  },
})

export type DestinationKey = keyof typeof destinations
