// 样例：每个情景一个目录，里面是从真的后端录下来的接口返回。
//
//   fixtures/<情景>/manifest.json
//     { "id", "title", "description", "signed_in", "user": {...},
//       "pages": [{ "title", "path" }],
//       "responses": [{ "method", "path", "query", "status", "file" | "body", "content_type" }],
//       "streams": [{ "path", "file" }] }
//
// 样例不在这里手写。各应用的样例由它后端的录制脚本生成（见 preview/README.md）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCENARIO_ID = /^[a-z][a-z0-9-]{0,40}$/

export function normalizeQuery(search) {
  const params = [...new URLSearchParams(search ?? '')]
  params.sort(([a, x], [b, y]) => (a === b ? x.localeCompare(y) : a.localeCompare(b)))
  return new URLSearchParams(params).toString()
}

export function loadScenarios(root) {
  const scenarios = new Map()
  if (!existsSync(root)) return scenarios
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SCENARIO_ID.test(entry.name)) continue
    const file = join(root, entry.name, 'manifest.json')
    if (!existsSync(file)) continue
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    if (manifest.id !== entry.name) {
      throw new Error(`preview: ${file} says id "${manifest.id}", directory is "${entry.name}"`)
    }
    scenarios.set(entry.name, {
      id: entry.name,
      title: String(manifest.title ?? entry.name),
      description: String(manifest.description ?? ''),
      signedIn: manifest.signed_in !== false,
      user: manifest.user ?? {},
      pages: Array.isArray(manifest.pages) ? manifest.pages : [],
      responses: Array.isArray(manifest.responses) ? manifest.responses : [],
      streams: Array.isArray(manifest.streams) ? manifest.streams : [],
      directory: join(root, entry.name),
    })
  }
  return scenarios
}

// 先按「方法 + 路径 + 参数」找；找不到再找同一路径、不看参数的那一条。
export function findResponse(scenario, method, path, search) {
  const query = normalizeQuery(search)
  const same = scenario.responses.filter(
    (r) => String(r.method ?? 'GET').toUpperCase() === method && r.path === path,
  )
  return (
    same.find((r) => normalizeQuery(r.query) === query && r.any_query !== true) ??
    same.find((r) => r.any_query === true) ??
    (query === '' ? undefined : same.find((r) => normalizeQuery(r.query) === ''))
  )
}

export function findStream(scenario, path) {
  return scenario.streams.find((s) => s.path === path)
}

export function readBody(scenario, response) {
  if (response.file) return readFileSync(join(scenario.directory, response.file))
  if (response.body === undefined) return Buffer.alloc(0)
  return Buffer.from(JSON.stringify(response.body))
}

export function readStream(scenario, stream) {
  const events = JSON.parse(readFileSync(join(scenario.directory, stream.file), 'utf8'))
  if (!Array.isArray(events)) throw new Error(`preview: ${stream.file} must hold a list`)
  return events
}

// 和后端的 sse_frame 一样：不带事件名，种类在 data 的 type 里
export function sseFrame(event) {
  return `id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`
}
