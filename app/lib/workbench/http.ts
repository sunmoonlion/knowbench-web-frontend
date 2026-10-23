// 工作台接口的收发。同源 /api/workbench；浏览器会话 cookie；改动类的请求带 CSRF；答复一律过 zod。
import { z } from 'zod'

import { problemSchema } from '@/contracts/workbench-v2'

export class WorkbenchError extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(code)
    this.name = 'WorkbenchError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

type Fetch = typeof fetch

async function exchange<T>(
  schema: z.ZodType<T>,
  path: string,
  init: RequestInit,
  fetchImpl: Fetch,
) {
  if (!path.startsWith('/api/workbench/')) throw new Error('workbench path expected')
  let response: Response
  try {
    response = await fetchImpl(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        'X-Correlation-Id': crypto.randomUUID(),
        ...init.headers,
      },
    })
  } catch (error) {
    throw new WorkbenchError('backend_unavailable', undefined, { cause: error })
  }
  if (!response.ok || response.type === 'opaqueredirect') {
    const problem = problemSchema.safeParse(await response.json().catch(() => null))
    throw new WorkbenchError(
      problem.success ? problem.data.code : 'backend_unavailable',
      response.status,
    )
  }
  // 204：没有正文（删除之类），按空对象过契约
  const parsed = schema.safeParse(
    response.status === 204 ? {} : await response.json().catch(() => null),
  )
  if (!parsed.success) {
    throw new WorkbenchError('contract_invalid', response.status, { cause: parsed.error })
  }
  return parsed.data
}

export function getJson<T>(schema: z.ZodType<T>, path: string, fetchImpl: Fetch = fetch) {
  return exchange(schema, path, { method: 'GET' }, fetchImpl)
}

export function sendJson<T>(
  schema: z.ZodType<T>,
  path: string,
  options: {
    csrfToken: string
    method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
    body?: unknown
    signal?: AbortSignal
  },
  fetchImpl: Fetch = fetch,
) {
  return exchange(
    schema,
    path,
    {
      method: options.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': options.csrfToken },
      body: JSON.stringify(options.body ?? {}),
      signal: options.signal,
    },
    fetchImpl,
  )
}

export function seg(value: string) {
  return encodeURIComponent(value)
}
