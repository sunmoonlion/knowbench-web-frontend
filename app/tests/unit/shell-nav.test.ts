import { describe, expect, it } from 'vitest'

import type { Conversation, Machine, Project, Workspace } from '@/contracts/workbench-v2'
import {
  FOOT,
  defaultWorkspace,
  footHref,
  machineLight,
  modeOf,
  projectsIn,
  recent,
  workspaceKey,
} from '@/features/shell/model/nav'
import { blockerOf } from '@/features/home/model/start'
import { conversationRoute, isBuilt, routes } from '@/lib/workbench/routes'

const E1 = '11111111-1111-4111-8111-111111111111'
const E2 = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'
const P2 = '44444444-4444-4444-8444-444444444444'
const C1 = '55555555-5555-4555-8555-555555555555'
const C2 = '66666666-6666-4666-8666-666666666666'

const office: Workspace = {
  environment_id: E1,
  environment_name: '办公室',
  online: true,
  root: '/r',
}
const home: Workspace = { environment_id: E2, environment_name: '家里', online: false, root: '/h' }

function project(id: string, at: Workspace, last: string | null, more: Partial<Project> = {}) {
  return {
    id,
    environment_id: at.environment_id,
    workspace_root: at.root,
    path: id,
    title: id.slice(0, 4),
    directory: `${at.root}/${id}`,
    archived: false,
    conversations: 0,
    last_active_at: last,
    environment_name: at.environment_name,
    online: at.online,
    ...more,
  } as Project
}

function conversation(id: string, more: Partial<Conversation>): Conversation {
  return {
    id,
    kind: 'chat',
    project_id: null,
    title: null,
    environment_id: null,
    project_root: null,
    thread_id: null,
    wheel: 'user',
    active_task_id: null,
    created_at: '2026-10-01T00:00:00Z',
    last_active_at: null,
    ...more,
  }
}

describe('地址', () => {
  it('一段对话在哪一页', () => {
    expect(conversationRoute('zh-CN', { id: C1, project_id: null, kind: 'chat' })).toBe(
      `/zh-CN/workbench/chat/${C1}`,
    )
    expect(conversationRoute('zh-CN', { id: C1, project_id: P1, kind: 'work' })).toBe(
      `/zh-CN/workbench/projects/${P1}/c/${C1}`,
    )
    expect(routes.home('zh-CN')).toBe('/zh-CN/workbench')
    expect(routes.home('zh-CN', 'chat')).toBe('/zh-CN/workbench?mode=chat')
    expect(routes.home('zh-CN', 'expert')).toBe('/zh-CN/workbench?mode=expert')
    expect(routes.askExpert('en', P1, C1)).toBe(
      `/en/workbench/projects/${P1}/expert/new?from=${C1}`,
    )
  })
})

describe('侧栏', () => {
  it('当前在哪个功能', () => {
    expect(modeOf('/zh-CN/workbench', '')).toBe('chat')
    expect(modeOf('/zh-CN/workbench', 'mode=work')).toBe('work')
    expect(modeOf(`/zh-CN/workbench/chat/${C1}`, 'mode=work')).toBe('chat')
    expect(modeOf('/zh-CN/workbench/expert', '')).toBe('expert')
    expect(modeOf(`/zh-CN/workbench/projects/${P1}/tasks/${C1}`, '')).toBe('expert')
    expect(
      modeOf(`/zh-CN/workbench/projects/${P1}/c/${C1}`, '', conversation(C1, { kind: 'work' })),
    ).toBe('work')
  })

  it('工作区下的项目：只列这个工作区的、没归档的，最近用的在前', () => {
    const all = [
      project(P1, office, '2026-10-01T00:00:00Z'),
      project(P2, office, '2026-10-03T00:00:00Z'),
      project(C1, office, null, { archived: true }),
      project(C2, home, '2026-10-02T00:00:00Z'),
    ]
    expect(projectsIn(all, office).map((each) => each.id)).toEqual([P2, P1])
    expect(projectsIn(all, undefined)).toEqual([])
    // 没选过工作区：最近用过的项目所在的那个
    expect(defaultWorkspace([home, office], all)).toBe(office)
    expect(defaultWorkspace([home, office], [])).toBe(home)
    expect(workspaceKey(office)).not.toBe(workspaceKey(home))
  })

  it('最近的对话：还没做的页不给链接', () => {
    const items = recent(
      [
        conversation(C1, { title: '甲', last_active_at: '2026-10-02T00:00:00Z' }),
        conversation(C2, {
          title: '乙',
          kind: 'work',
          project_id: P1,
          wheel: 'advisor',
          last_active_at: '2026-10-03T00:00:00Z',
        }),
      ],
      [project(P1, office, null, { title: '恒瑞医药' })],
      'zh-CN',
    )
    expect(items.map((item) => item.title)).toEqual(['乙', '甲'])
    expect(items[0]).toMatchObject({ busy: true, project: '恒瑞医药' })
    expect(items[1].href).toBe(`/zh-CN/workbench/chat/${C1}`)
    expect(items[0].href).toBe(
      isBuilt('projectConversation') ? `/zh-CN/workbench/projects/${P1}/c/${C2}` : null,
    )
  })

  it('我的机器的灯', () => {
    const machine = (status: string) => ({ id: E1, name: 'm', status, roots: [] }) as Machine
    expect(machineLight([])).toBe('none')
    expect(machineLight([machine('offline')])).toBe('offline')
    expect(machineLight([machine('offline'), machine('online')])).toBe('online')
  })

  it('底部的条目由一份清单生成', () => {
    // 公共数据的入口不在用户侧（所有者 2026-10-07 定）：没有数据目录、申请入库
    // 「我的电脑」不再单列，灯在中段的电脑行上（0016 S2）
    // 本地知识库（0019/0022）排在旧知识库（0011，等账 85 撤）前面
    expect(FOOT.map((entry) => entry.key)).toEqual([
      'pending',
      'localLibrary',
      'library',
      'memory',
      'settings',
    ])
    const settings = FOOT.find((entry) => entry.key === 'settings')!
    expect(footHref(settings, 'zh-CN')).toBe('/zh-CN/workbench/settings/cloud')
    const library = FOOT.find((entry) => entry.key === 'library')!
    expect(footHref(library, 'zh-CN')).toBe('/zh-CN/workbench/library')
  })
})

describe('首页：现在能不能开始', () => {
  const ready = { text: '问', sandboxes: 1, machines: [] as Machine[], project: undefined }
  it('聊天：有字、有沙箱就行，不用项目、不用机器', () => {
    expect(blockerOf({ ...ready, mode: 'chat' })).toBeNull()
    expect(blockerOf({ ...ready, mode: 'chat', text: '  ' })).toBe('empty')
    expect(blockerOf({ ...ready, mode: 'chat', sandboxes: 0 })).toBe('noSandbox')
    // 沙箱的清单还没取回来：不拦
    expect(blockerOf({ ...ready, mode: 'chat', sandboxes: undefined })).toBeNull()
  })
  it('工作、专家：页面还没做的时候说「还在做」', () => {
    for (const mode of ['work', 'expert'] as const) {
      const page = mode === 'work' ? 'projectConversation' : 'askExpert'
      if (!isBuilt(page)) expect(blockerOf({ ...ready, mode })).toBe('notBuilt')
    }
  })
  it('工作/专家缺电脑时优先引导接入；聊天只看云端沙箱', () => {
    expect(blockerOf({ ...ready, sandboxes: 0, mode: 'work' })).toBe('noMachine')
    expect(blockerOf({ ...ready, sandboxes: 0, mode: 'expert' })).toBe('noMachine')
    expect(blockerOf({ ...ready, sandboxes: 0, mode: 'chat' })).toBe('noSandbox')
  })
})
