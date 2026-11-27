import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixtures = join(process.cwd(), 'preview/fixtures/full')
const manifest = JSON.parse(readFileSync(join(fixtures, 'manifest.json'), 'utf8')) as {
  responses: { method: string; path: string; file: string }[]
}
const project = 'd1d13ed0-4e39-5486-b0c6-c7b80742eb0e'
const task = 'aaaaaaaa-1111-4111-8111-111111111111'

test('the sidebar and expert answer share the viewport after refreshing a completed match', async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: 'sunmoonai_knowbench_web_sid',
      value: 'e2e-session',
      domain: '127.0.0.1',
      path: '/',
    },
  ])
  await page.setViewportSize({ width: 1366, height: 850 })
  await page.route('**/api/workbench/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/expert/entry')) return route.fulfill({ json: { unified: true } })
    if (path.endsWith('/find-expert/' + task))
      return route.fulfill({
        json: {
          task_id: task,
          project_id: project,
          question: '你好',
          state: 'SUCCEEDED',
          formal: {
            review_digest: 'fixture',
            more: false,
            selected: null,
            scope_preview: null,
            options: [],
            match: {
              outcome: 'clarify',
              explanation: '请先明确需求',
              clarification: '您需要核对哪张报表？',
              requirements: [],
              picks: [],
            },
          },
        },
      })
    const fixture = manifest.responses.find(
      (entry) => entry.method === 'GET' && entry.path === path,
    )
    if (!fixture) return route.continue()
    const data = JSON.parse(readFileSync(join(fixtures, fixture.file), 'utf8'))
    if (path === '/api/workbench/projects') {
      data.projects.find((item: { id: string }) => item.id === project).title =
        '很长的专家核验项目名称'.repeat(25)
    }
    return route.fulfill({ json: data })
  })
  await page.goto('/zh-CN/workbench/projects/' + project + '/expert/new?formalMatch=' + task)
  const answer = page.getByText('您需要核对哪张报表？', { exact: true })
  await expect(answer).toBeInViewport()
  const refreshed = await page.reload()
  expect(refreshed?.headers()['content-security-policy']).toMatch(/style-src 'self' 'nonce-/)
  const sidebar = page.locator('aside[data-state]')
  const collapse = sidebar.getByRole('button', { name: '折叠侧边栏' })
  const expand = sidebar.getByRole('button', { name: '展开侧边栏' })
  await expect(sidebar).toHaveCSS('width', '240px')
  await expect(collapse).toBeInViewport()
  await expect(answer).toBeInViewport()
  const handle = sidebar.getByRole('separator')
  await handle.press('ArrowRight')
  await expect(sidebar).toHaveCSS('width', '256px')
  await page.reload()
  await expect(sidebar).toHaveCSS('width', '256px')
  await collapse.click()
  await page.reload()
  await expect(expand).toBeInViewport()
  await expand.click()
  await expect(sidebar).toHaveCSS('width', '256px')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(expand).toBeInViewport()
  await expect(answer).toBeInViewport()
  await expand.click()
  await expect(collapse).toBeInViewport()
})
