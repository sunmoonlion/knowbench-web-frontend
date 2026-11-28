// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { browserSessionSchema } from '@/contracts/auth'
import {
  crossAppLinksSchema,
  crossAppNamePattern,
  crossAppOriginSchema,
  crossAppRefPattern,
} from '@/contracts/cross-app'
import * as previewCrossApp from '@/preview/lib/cross-app.mjs'
import { findResponse, normalizeQuery, sseFrame } from '@/preview/lib/samples.mjs'
import { createPreviewServer } from '@/preview/server.mjs'

const TASK = '11111111-1111-4111-8111-111111111111'

let root: string
let upstream: Server
let preview: Server
let base: string
const logged: string[] = []

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

function scenario(id: string, manifest: Record<string, unknown>, files: Record<string, unknown>) {
  const directory = join(root, id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ id, ...manifest }))
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(directory, name), JSON.stringify(body))
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'preview-'))
  scenario(
    'default',
    {
      title: '登录之后',
      description: '样例',
      user: { display_name: '样例用户' },
      pages: [{ title: '首页', path: '/zh-CN/workbench' }],
      responses: [
        { method: 'GET', path: '/api/empty-record', body: null },
        { method: 'GET', path: '/api/missing-record', file: 'not-recorded.json' },
        { method: 'GET', path: '/api/no-content', status: 204, body: null },
        { method: 'GET', path: '/api/workbench/projects', file: 'projects.json' },
        {
          method: 'GET',
          path: '/api/workbench/sessions',
          query: 'project_id=p1',
          file: 'sessions-p1.json',
        },
        { method: 'GET', path: '/api/workbench/sessions', file: 'sessions.json' },
        { method: 'GET', path: '/api/workbench/library/dossier:t1', file: 'dossier.json' },
        {
          method: 'POST',
          path: `/api/workbench/tasks/${TASK}/cancel`,
          status: 202,
          body: { state: 'CANCELLED' },
        },
      ],
      streams: [{ path: '/api/workbench/sessions/s1/stream', file: 'stream.json' }],
    },
    {
      'projects.json': { contract_version: 2, projects: [{ id: 'p1', title: '恒瑞医药研究' }] },
      'sessions.json': { sessions: ['all'] },
      'sessions-p1.json': { sessions: ['of p1'] },
      'dossier.json': { item: { id: 'dossier:t1' } },
      'stream.json': [
        { cursor: 1, type: 'turn/requested', payload: { text: '你好' } },
        { cursor: 2, type: 'item/completed', payload: { item: { type: 'agentMessage' } } },
        { cursor: 3, type: 'turn/completed', payload: {} },
      ],
    },
  )
  scenario(
    'signed-out',
    { title: '没有登录', description: '', signed_in: false, pages: [], responses: [] },
    {},
  )
  upstream = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'x-served-by': 'next' })
    response.end(`<html>page ${request.url}</html>`)
  })
  const nextPort = await listen(upstream)
  preview = createPreviewServer({
    config: {
      app: 'tpl',
      port: 0,
      nextPort,
      apps: { knowfeed: 'http://localhost:3110', knowbase: 'http://localhost:3120' },
      targets: ['knowfeed', 'elsewhere'],
      defaultScenario: 'default',
      sources: {
        knowbench: { return_url: 'http://localhost:3100/zh-CN/workbench?ref={ref}' },
        knowbase: {},
      },
    },
    fixturesRoot: root,
    log: (line: string) => logged.push(line),
  })
  base = `http://127.0.0.1:${await listen(preview)}`
})

afterAll(() => {
  preview.close()
  upstream.close()
  rmSync(root, { recursive: true, force: true })
})

describe('preview: signing in', () => {
  it('answers the session in the shape the real backend uses', async () => {
    const got = await fetch(`${base}/api/auth/web/me`)
    expect(got.status).toBe(200)
    const session = browserSessionSchema.parse(await got.json())
    expect(session.user.app).toBe('tpl')
    expect(session.user.display_name).toBe('样例用户')
  })

  it('is signed out in a scenario that says so, and signs in on the login address', async () => {
    const out = { cookie: 'preview_scenario=signed-out' }
    expect((await fetch(`${base}/api/auth/web/me`, { headers: out })).status).toBe(401)
    expect((await fetch(`${base}/api/workbench/projects`, { headers: out })).status).toBe(401)
    const login = await fetch(
      `${base}/api/auth/web/login?return_to=${encodeURIComponent('/zh-CN/dashboard')}`,
      { headers: out, redirect: 'manual' },
    )
    expect(login.status).toBe(302)
    expect(login.headers.get('location')).toBe('/zh-CN/dashboard')
    expect(login.headers.get('set-cookie')).toContain('preview_signed_in=1')
  })

  it('never sends the person to another site after login', async () => {
    for (const evil of ['https://evil.example.test/', '//evil.example.test', '/a\\b']) {
      const login = await fetch(
        `${base}/api/auth/web/login?return_to=${encodeURIComponent(evil)}`,
        { redirect: 'manual' },
      )
      expect(login.headers.get('location')).toBe('/')
    }
  })

  it('signs out only with the anti-forgery token', async () => {
    const refused = await fetch(`${base}/api/auth/web/logout`, { method: 'POST' })
    expect(refused.status).toBe(403)
    const session = await (await fetch(`${base}/api/auth/web/me`)).json()
    const done = await fetch(`${base}/api/auth/web/logout`, {
      method: 'POST',
      headers: { 'x-csrf-token': session.csrf_token },
    })
    expect(done.status).toBe(204)
    expect(done.headers.get('set-cookie')).toContain('preview_signed_in=0')
  })
})

describe('preview: samples', () => {
  it('serves a recorded answer', async () => {
    const got = await fetch(`${base}/api/workbench/projects`)
    expect(got.status).toBe(200)
    expect(got.headers.get('cache-control')).toBe('no-store')
    expect(await got.json()).toEqual({
      contract_version: 2,
      projects: [{ id: 'p1', title: '恒瑞医药研究' }],
    })
  })

  it('tells answers with different parameters apart', async () => {
    const of = async (query: string) =>
      (await (await fetch(`${base}/api/workbench/sessions${query}`)).json()).sessions[0]
    expect(await of('')).toBe('all')
    expect(await of('?project_id=p1')).toBe('of p1')
    // 没录过的参数组合：给不带参数的那一份
    expect(await of('?project_id=p2')).toBe('all')
  })

  it('matches a path the browser sent encoded, as the real backend does', async () => {
    // 页面把 dossier:t1 编成 dossier%3At1；真后端解码后再路由，样例也按解码后的路径找
    const got = await fetch(`${base}/api/workbench/library/dossier%3At1`)
    expect(got.status).toBe(200)
    expect(await got.json()).toEqual({ item: { id: 'dossier:t1' } })
  })

  it('answers a recorded change with its recorded status', async () => {
    const got = await fetch(`${base}/api/workbench/tasks/${TASK}/cancel`, { method: 'POST' })
    expect(got.status).toBe(202)
    expect(await got.json()).toEqual({ state: 'CANCELLED' })
  })

  it('says so when there is no sample, and remembers what was asked for', async () => {
    const read = await fetch(`${base}/api/workbench/nothing-here`)
    expect(read.status).toBe(404)
    expect((await read.json()).code).toBe('preview_no_sample')
    const change = await fetch(`${base}/api/workbench/projects`, { method: 'POST' })
    expect(change.status).toBe(501)
    expect(logged.join('\n')).toContain('GET /api/workbench/nothing-here')
    const index = await (await fetch(`${base}/__preview`)).text()
    expect(index).toContain('没有样例的请求')
    expect(index).toContain('POST /api/workbench/projects')
  })

  it('replays an event stream frame by frame, from where the page left off', async () => {
    const got = await fetch(`${base}/api/workbench/sessions/s1/stream?after=1`)
    expect(got.headers.get('content-type')).toContain('text/event-stream')
    const reader = got.body!.getReader()
    let text = ''
    while (!text.includes('turn/completed')) {
      const { value, done } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
    }
    await reader.cancel()
    expect(text).not.toContain('"cursor":1,')
    expect(text.startsWith('id: 2\ndata: {')).toBe(true)
    expect(text).toContain('id: 3\ndata: ')
    expect(text).not.toContain('event:')
  })
})

describe('preview: moving between applications', () => {
  it('uses the very same rules as the contract', () => {
    expect(previewCrossApp.crossAppNamePattern.source).toBe(crossAppNamePattern.source)
    expect(previewCrossApp.crossAppRefPattern.source).toBe(crossAppRefPattern.source)
  })

  it('answers like the backend does', async () => {
    const links = crossAppLinksSchema.parse(
      await (await fetch(`${base}/api/web/v1/cross-app/links`)).json(),
    )
    expect(links).toEqual({
      app: 'tpl',
      targets: { knowfeed: { web_base_url: 'http://localhost:3110' } },
    })
    const origin = async (query: string) =>
      crossAppOriginSchema.parse(
        await (await fetch(`${base}/api/web/v1/cross-app/origin${query}`)).json(),
      )
    expect(await origin('?from=knowbench&ref=task:42')).toEqual({
      app: 'knowbench',
      ref: 'task:42',
      return_url: 'http://localhost:3100/zh-CN/workbench?ref=task%3A42',
    })
    expect(await origin('?from=knowbase&ref=bad%20ref')).toEqual({
      app: 'knowbase',
      ref: null,
      return_url: null,
    })
    expect(await origin('?from=unknown')).toBeNull()
    expect(await origin('?from=knowbench&return_url=https://evil.example.test')).toMatchObject({
      return_url: 'http://localhost:3100/zh-CN/workbench?ref=',
    })
  })
})

describe('preview: the front door', () => {
  it('hands every page to Next', async () => {
    const got = await fetch(`${base}/zh-CN/dashboard?x=1`)
    expect(got.headers.get('x-served-by')).toBe('next')
    expect(await got.text()).toBe('<html>page /zh-CN/dashboard?x=1</html>')
  })

  it('lists the scenarios and their pages, and switches between them', async () => {
    const index = await (await fetch(`${base}/__preview`)).text()
    expect(index).toContain('登录之后')
    expect(index).toContain('没有登录')
    expect(index).toContain('/__preview/use/default?to=%2Fzh-CN%2Fworkbench')
    expect(index).toContain('不是真实数据')
    const use = await fetch(`${base}/__preview/use/signed-out?to=/zh-CN/login`, {
      redirect: 'manual',
    })
    expect(use.status).toBe(302)
    expect(use.headers.get('location')).toBe('/zh-CN/login')
    expect(use.headers.get('set-cookie')).toContain('preview_scenario=signed-out')
    expect((await fetch(`${base}/__preview/use/nope`, { redirect: 'manual' })).status).toBe(404)
    // 默认的情景排在最前面
    expect(index.indexOf('登录之后')).toBeLessThan(index.indexOf('没有登录'))
  })
})

describe('preview: how samples are matched', () => {
  it('ignores the order of parameters', () => {
    expect(normalizeQuery('?b=2&a=1')).toBe(normalizeQuery('a=1&b=2'))
    const found = findResponse(
      { responses: [{ method: 'GET', path: '/api/x', query: 'a=1&b=2', file: 'x.json' }] },
      'GET',
      '/api/x',
      '?b=2&a=1',
    )
    expect(found?.file).toBe('x.json')
  })

  it('frames events the way the backend does', () => {
    expect(sseFrame({ cursor: 7, type: 'turn/completed' })).toBe(
      'id: 7\ndata: {"cursor":7,"type":"turn/completed"}\n\n',
    )
  })
})

it('distinguishes an absent fixture, JSON null and a bodyless success', async () => {
  const missing = await fetch(base + '/api/missing-record')
  expect(missing.status).toBe(500)
  expect((await missing.json()).message).toContain('not-recorded.json')
  const empty = await fetch(base + '/api/empty-record')
  expect(empty.status).toBe(200)
  expect(await empty.json()).toBeNull()
  const noContent = await fetch(base + '/api/no-content')
  expect(noContent.status).toBe(204)
  expect(await noContent.text()).toBe('')
})
