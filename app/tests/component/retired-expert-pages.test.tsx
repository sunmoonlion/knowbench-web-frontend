import { expect, it, vi } from 'vitest'
import Home from '@/app/[locale]/(dashboard)/workbench/page'
import Ask from '@/app/[locale]/(dashboard)/workbench/projects/[project]/expert/new/page'

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_404')
  },
}))
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }))
vi.mock('@/features/home', () => ({ HomeScreen: () => null }))
vi.mock('@/features/expert', () => ({ AskExpertScreen: () => null }))

it.each([{ match: 'old-task' }, { expert: 'old-pack' }, { expert: ['a', 'b'] }])(
  '旧书签不再打开首页或项目的匹配结果 %j',
  async (query) => {
    await expect(Home({ searchParams: Promise.resolve(query) })).rejects.toThrow('NEXT_404')
    await expect(
      Ask({ params: Promise.resolve({ project: 'p' }), searchParams: Promise.resolve(query) }),
    ).rejects.toThrow('NEXT_404')
  },
)

it('旧商城结果回跳失效，正式版本仍能进入', async () => {
  await expect(
    Home({ searchParams: Promise.resolve({ knowbot: 'k', task: 't' }) }),
  ).rejects.toThrow('NEXT_404')
  await expect(
    Home({ searchParams: Promise.resolve({ formalReference: 'pin' }) }),
  ).resolves.toBeDefined()
})
