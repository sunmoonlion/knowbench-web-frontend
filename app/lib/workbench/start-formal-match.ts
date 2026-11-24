import { z } from 'zod'
import { formalMethodReferenceSchema as pin } from './formal-method-reference'
import { seg, sendJson } from './http'

const started = z.union([
  z.object({ task_id: z.uuid() }),
  z.object({ empty: z.literal(true), next: z.number().int().positive().nullable() }),
])

export const startRound = (
  project: string,
  csrfToken: string,
  body: {
    idempotency_key: string
    question: string
    revises?: string
    reference?: z.infer<typeof pin>
    source_session?: string
    directory_offset?: number
  },
) =>
  sendJson(started, `/api/workbench/projects/${seg(project)}/find-expert`, {
    csrfToken,
    body: {
      ...body,
      retain_empty: true,
      budget_limit: '2',
      match_contract: 'knowbench/expert-match/v5',
    },
  })
