'use client'

import { sessionFetch, assertSessionResponse } from '@/lib/auth/session-recovery'

export type ApiProblem = {
  code: string
  message_key: string
  retryable: boolean
  correlation_id: string
  field_errors?: Record<string, string[]>
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ApiProblem,
  ) {
    super(problem.message_key)
    this.name = 'ApiClientError'
  }
}

type RequestJsonOptions = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown
  csrfToken?: string
  headers?: Record<string, string>
}

function correlationId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function requestJson<T>(path: string, options: RequestJsonOptions = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('API path must be a same-origin /api/ path')
  }
  const method = (options.method ?? 'GET').toUpperCase()
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  const requestCorrelationId = correlationId()
  const response = await sessionFetch(path, {
    ...options,
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'manual',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      Accept: 'application/json',
      'X-Correlation-ID': requestCorrelationId,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(unsafe && options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      normalizeProblem(await safeJson(response), requestCorrelationId),
    )
  }
  const payload = response.status === 204 ? undefined : await response.json()
  assertSessionResponse(response)
  return payload as T
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function normalizeProblem(payload: unknown, fallbackCorrelationId: string): ApiProblem {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      code: 'unexpected_response',
      message_key: 'errors.unexpected',
      retryable: false,
      correlation_id: fallbackCorrelationId,
    }
  }
  const candidate = payload as Record<string, unknown>
  return {
    code: typeof candidate.code === 'string' ? candidate.code : 'request_failed',
    message_key:
      typeof candidate.message_key === 'string' ? candidate.message_key : 'errors.requestFailed',
    retryable: candidate.retryable === true,
    correlation_id:
      typeof candidate.correlation_id === 'string'
        ? candidate.correlation_id
        : fallbackCorrelationId,
    field_errors:
      candidate.field_errors && typeof candidate.field_errors === 'object'
        ? (candidate.field_errors as Record<string, string[]>)
        : undefined,
  }
}
