import {
  assertSessionResponse,
  sessionFetch,
  SessionRequestError,
} from '@/lib/auth/session-recovery'
import {
  apiErrorSchema,
  cancelRunRequestSchema,
  createRunRequestSchema,
  runEventSchema,
  runSnapshotSchema,
  type CancelRunRequest,
  type CreateRunRequest,
  type RunAction,
  type RunEvent,
  type RunSnapshot,
} from '@/contracts/interaction'

export class InteractionClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly operationId?: string,
    options?: { cause?: unknown },
  ) {
    super(code)
    this.name = 'InteractionClientError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

export async function fetchRunSnapshot(
  runId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunSnapshot> {
  return requestSnapshot(
    `/api/web/v1/runs/${encodeURIComponent(runId)}`,
    { method: 'GET' },
    fetchImpl,
  )
}

export async function createRun(
  command: CreateRunRequest,
  csrfToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunSnapshot> {
  return requestSnapshot(
    '/api/web/v1/runs',
    {
      method: 'POST',
      headers: mutationHeaders(csrfToken),
      body: JSON.stringify(createRunRequestSchema.parse(command)),
    },
    fetchImpl,
  )
}

export async function submitRunAction(
  runId: string,
  action: RunAction,
  csrfToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunSnapshot> {
  return requestSnapshot(
    `/api/web/v1/runs/${encodeURIComponent(runId)}/actions`,
    {
      method: 'POST',
      headers: mutationHeaders(csrfToken),
      body: JSON.stringify(action),
    },
    fetchImpl,
  )
}

export async function cancelRun(
  runId: string,
  command: CancelRunRequest,
  csrfToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunSnapshot> {
  return requestSnapshot(
    `/api/web/v1/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
      headers: mutationHeaders(csrfToken),
      body: JSON.stringify(cancelRunRequestSchema.parse(command)),
    },
    fetchImpl,
  )
}

export function parseRunEventPayload(data: string, lastEventId: string): RunEvent {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch (error) {
    throw new InteractionClientError('contract_invalid', undefined, { cause: error })
  }
  const parsed = runEventSchema.safeParse(value)
  if (!parsed.success || (lastEventId && parsed.data.event_id !== lastEventId)) {
    throw new InteractionClientError('contract_invalid', undefined, {
      cause: parsed.success ? undefined : parsed.error,
    })
  }
  return parsed.data
}

async function requestSnapshot(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<RunSnapshot> {
  let response: Response
  try {
    response = await sessionFetch(
      url,
      {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          ...init.headers,
        },
      },
      fetchImpl,
    )
  } catch (error) {
    if (error instanceof SessionRequestError) throw error
    throw new InteractionClientError('backend_unavailable', undefined, { cause: error })
  }
  if (!response.ok || response.type === 'opaqueredirect') {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null))
    throw new InteractionClientError(
      parsed.success ? parsed.data.error.code : 'backend_unavailable',
      parsed.success ? parsed.data.error.operation_id : undefined,
    )
  }
  const parsed = runSnapshotSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    throw new InteractionClientError('contract_invalid', undefined, { cause: parsed.error })
  }
  assertSessionResponse(response)
  return parsed.data
}

function mutationHeaders(csrfToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  }
}
