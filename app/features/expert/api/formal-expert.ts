import { z } from 'zod'
import { formalMethodReferenceSchema as pin } from '@/lib/workbench/formal-method-reference'
import { getJson, seg, sendJson } from '@/lib/workbench/http'

const started = z.union([
  z.object({ task_id: z.uuid() }),
  z.object({ empty: z.literal(true), next: z.number().int().positive().nullable() }),
])
const receipt = z.object({ review_digest: z.string(), reference: pin })
const entry = z.object({
  reference: pin,
  declaration: z.object({
    title: z.string(),
    applies_when: z.array(z.string()),
    excludes: z.array(z.string()),
    promises: z.record(z.string(), z.string()),
    conditions: z
      .record(z.string(), z.object({ when: z.string(), input_slots: z.array(z.string()) }))
      .optional(),
  }),
  promise_outputs: z.record(z.string(), z.array(z.string())),
})
const names = z.array(z.string())
const scope = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      depends_on: names,
      required_when: z.string().nullable(),
      candidate_count: z.number().int().positive(),
    }),
  ),
  inputs: z.array(
    z.object({ name: z.string(), description: z.string(), required_by: names, used_by: names }),
  ),
  outputs: z.array(z.object({ name: z.string(), description: z.string(), step: z.string() })),
  requirements: z.array(
    z.object({
      id: z.string(),
      capability: z.string(),
      version: z.string(),
      operations: names,
      resource_roles: names,
      destination: z.string(),
      fields: names,
      purpose: z.string(),
    }),
  ),
  approvals: z.array(z.object({ requirement_id: z.string(), operations: names, when: z.string() })),
})
export type FrozenScope = z.infer<typeof scope>
const reviewed = z.object({
  task_id: z.uuid(),
  project_id: z.string(),
  question: z.string(),
  state: z.string(),
  superseded_by: z.uuid().optional(),
  session_id: z.uuid().optional(),
  error: z.string().optional(),
  formal: z
    .object({
      review_digest: z.string(),
      more: z.boolean(),
      selected: pin.nullable(),
      scope_preview: scope.nullable(),
      options: z.array(entry),
      match: z.object({
        explanation: z.string(),
        clarification: z.string().nullable(),
        requirements: z.array(z.object({ id: z.string(), statement: z.string() })),
        picks: z.array(
          z.object({
            reference: pin,
            reason: z.string(),
            limitations: z.array(z.string()),
            coverage: z.array(
              z.object({ requirement: z.string(), promise: z.string(), quote: z.string() }),
            ),
          }),
        ),
      }),
    })
    .optional(),
})

export const readRound = (task: string) =>
  getJson(reviewed, `/api/workbench/find-expert/${seg(task)}`)
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
    body: { ...body, budget_limit: '2', match_contract: 'knowbench/expert-match/v5' },
  })
export const selectVersion = (
  task: string,
  csrfToken: string,
  reference: z.infer<typeof pin>,
  review_digest: string,
) =>
  sendJson(receipt, `/api/workbench/find-expert/${seg(task)}/selection`, {
    method: 'PUT',
    csrfToken,
    body: { reference, review_digest },
  })
