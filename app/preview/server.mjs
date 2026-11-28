// 预览的前门。浏览器只访问这一个端口：
//   /api/…       由样例答（从真的后端录下来的返回）
//   /__preview   目录页：有哪些情景、每个情景里有哪些页面
//   其余         交给 Next
//
// 网页端的代码里没有任何预览的分支：它以为自己连的是真的后端。
// 所以预览不进正式构建，也不随网页端的目录怎么排而变。
import { createServer, request as forward } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'

import { linksAnswer, originAnswer } from './lib/cross-app.mjs'
import { indexPage } from './lib/index-page.mjs'
import {
  findResponse,
  findStream,
  loadScenarios,
  readBody,
  readStream,
  sseFrame,
} from './lib/samples.mjs'
import {
  PREVIEW_CSRF,
  browserSession,
  isSignedIn,
  parseCookies,
  safeReturnTo,
} from './lib/session.mjs'

const HOST = '127.0.0.1'
const STREAM_STEP_MS = 60
const KEEPALIVE_MS = 15_000

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  response.end(body === undefined ? '' : JSON.stringify(body))
}

function cookie(name, value) {
  return `${name}=${value}; Path=/; SameSite=Lax; HttpOnly`
}

function problem(response, status, code, message) {
  json(response, status, {
    code,
    message_key: `errors.${code}`,
    message,
    retryable: false,
    correlation_id: 'preview',
  })
}

/**
 * @typedef {{ app: string, port: number, nextPort: number, apps: Record<string, string>,
 *   targets: string[], sources: Record<string, { return_url?: string }>,
 *   defaultScenario?: string }} PreviewConfig
 * @param {{ config: PreviewConfig, fixturesRoot: string, log?: (line: string) => void }} options
 */
export function createPreviewServer({ config, fixturesRoot, log = () => {} }) {
  const missing = []

  function scenarioOf(cookies, scenarios) {
    const wanted = cookies.preview_scenario
    if (wanted && scenarios.has(wanted)) return scenarios.get(wanted)
    return (
      scenarios.get(config.defaultScenario ?? 'default') ??
      scenarios.get('default') ??
      [...scenarios.values()][0]
    )
  }

  function preview(request, response, url, cookies, scenarios) {
    const scenario = scenarioOf(cookies, scenarios)
    if (url.pathname === '/__preview' || url.pathname === '/__preview/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(
        indexPage({
          config,
          scenarios,
          current: scenario?.id,
          signedIn: isSignedIn(cookies, scenario),
          missing: missing.slice(-20),
        }),
      )
      return
    }
    if (url.pathname === '/__preview/health') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
      return
    }
    const use = /^\/__preview\/use\/([a-z][a-z0-9-]{0,40})$/.exec(url.pathname)
    if (use && scenarios.has(use[1])) {
      const chosen = scenarios.get(use[1])
      response.writeHead(302, {
        location: safeReturnTo(url.searchParams.get('to'), '/__preview'),
        'set-cookie': [
          cookie('preview_scenario', chosen.id),
          cookie('preview_signed_in', chosen.signedIn ? '1' : '0'),
        ],
      })
      response.end()
      return
    }
    const sign = /^\/__preview\/sign\/(in|out)$/.exec(url.pathname)
    if (sign) {
      response.writeHead(302, {
        location: '/__preview',
        'set-cookie': cookie('preview_signed_in', sign[1] === 'in' ? '1' : '0'),
      })
      response.end()
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('预览里没有这个地址')
  }

  function auth(request, response, url, cookies, scenario) {
    const action = url.pathname.slice('/api/auth/web/'.length)
    if (action === 'me' && request.method === 'GET') {
      if (!isSignedIn(cookies, scenario))
        return problem(response, 401, 'unauthenticated', '没有登录')
      return json(response, 200, browserSession(config.app, scenario))
    }
    if (['login', 'signup', 'continue'].includes(action) && request.method === 'GET') {
      response.writeHead(302, {
        location: safeReturnTo(url.searchParams.get('return_to'), '/'),
        'set-cookie': cookie('preview_signed_in', '1'),
        'cache-control': 'no-store',
      })
      response.end()
      return
    }
    if (action === 'logout' && request.method === 'POST') {
      if (request.headers['x-csrf-token'] !== PREVIEW_CSRF) {
        return problem(response, 403, 'csrf_failed', '缺少防伪造的令牌')
      }
      response.writeHead(204, { 'set-cookie': cookie('preview_signed_in', '0') })
      response.end()
      return
    }
    problem(response, 404, 'preview_no_sample', `预览里没有这个地址：${url.pathname}`)
  }

  function stream(request, response, url, scenario, found) {
    const after = Number(url.searchParams.get('after') ?? 0) || 0
    const events = readStream(scenario, found).filter((e) => Number(e.cursor) > after)
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    let at = 0
    const step = setInterval(() => {
      if (at < events.length) response.write(sseFrame(events[at++]))
    }, STREAM_STEP_MS)
    const alive = setInterval(() => response.write(': keepalive\n\n'), KEEPALIVE_MS)
    request.on('close', () => {
      clearInterval(step)
      clearInterval(alive)
    })
  }

  function decodePath(pathname) {
    try {
      return decodeURIComponent(pathname)
    } catch {
      return pathname
    }
  }

  function api(request, response, url, cookies, scenarios) {
    const scenario = scenarioOf(cookies, scenarios)
    const method = String(request.method ?? 'GET').toUpperCase()
    if (url.pathname.startsWith('/api/auth/web/')) {
      return auth(request, response, url, cookies, scenario)
    }
    if (!isSignedIn(cookies, scenario)) {
      return problem(response, 401, 'unauthenticated', '没有登录')
    }
    if (method === 'GET' && url.pathname === '/api/web/v1/cross-app/links') {
      return json(response, 200, linksAnswer(config))
    }
    if (method === 'GET' && url.pathname === '/api/web/v1/cross-app/origin') {
      return json(response, 200, originAnswer(config, url.search))
    }
    if (scenario) {
      // 真后端按解码后的路径段匹配（dossier%3A… 到路由时已是 dossier:…），样例也照此比对
      const path = decodePath(url.pathname)
      const live = method === 'GET' ? findStream(scenario, path) : undefined
      if (live) return stream(request, response, url, scenario, live)
      const found = findResponse(scenario, method, path, url.search)
      if (found) {
        const status = Number(found.status ?? 200)
        const body = status === 204 || status === 304 ? undefined : readBody(scenario, found)
        response.writeHead(status, {
          'content-type': found.content_type ?? 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          ...(found.headers ?? {}),
        })
        response.end(body)
        return
      }
    }
    const line = `${method} ${url.pathname}${url.search}`
    if (!missing.includes(line)) missing.push(line)
    log(`没有样例：${line}（情景 ${scenario?.id ?? '无'}）`)
    // 改动类的请求没有样例：明说，不装作成功
    problem(
      response,
      method === 'GET' ? 404 : 501,
      'preview_no_sample',
      `预览里没有这个请求的样例：${line}`,
    )
  }

  function next(request, response) {
    const upstream = forward(
      {
        hostname: HOST,
        port: config.nextPort,
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          'x-forwarded-host': request.headers.host ?? '',
          'x-forwarded-proto': 'http',
        },
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(response)
      },
    )
    upstream.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      }
      response.end('Next 还没有起来，稍等几秒再刷新')
    })
    request.pipe(upstream)
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const cookies = parseCookies(request.headers.cookie)
    // 每次请求重读样例：重新录过之后不用重启预览
    let scenarios
    try {
      scenarios = loadScenarios(fixturesRoot)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(`样例读不了：${error.message}`)
      return
    }
    try {
      if (url.pathname.startsWith('/__preview')) {
        return preview(request, response, url, cookies, scenarios)
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return api(request, response, url, cookies, scenarios)
      }
      return next(request, response)
    } catch (error) {
      log(`出错：${error.stack ?? error}`)
      if (!response.headersSent) problem(response, 500, 'preview_failed', String(error.message))
      else response.end()
    }
  })

  // 开发时 Next 用 WebSocket 推送改动：原样接过去
  server.on('upgrade', (request, socket, head) => {
    const upstream = connect(config.nextPort, HOST, () => {
      const lines = [`${request.method} ${request.url} HTTP/1.1`]
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        lines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`)
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })

  return server
}

export function fixturesRootOf(directory) {
  return join(directory, 'fixtures')
}
