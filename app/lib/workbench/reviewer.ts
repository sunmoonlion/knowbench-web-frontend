import { z } from 'zod'
import { getJson, sendJson } from './http'

export const reviewerPin = z.object({
  provider: z.string(),
  model: z.string(),
  credential_id: z.uuid(),
})
export const reviewerOption = z.object({
  pin: reviewerPin,
  family: z.string().nullable(),
  destination: z.string(),
  currency: z.string(),
  price_as_of: z.string(),
  price_key: z.string(),
  quote: z.object({ maximum: z.string() }).nullable(),
})
const reviewerView = z.object({
  preference: reviewerPin.nullable(),
  options: z.array(reviewerOption),
  gap: z.string().nullable(),
  producer: z.object({ provider: z.string(), model: z.string() }).nullable(),
})
export type ReviewerPin = z.infer<typeof reviewerPin>
export const pinKey = (p: ReviewerPin) => JSON.stringify([p.credential_id, p.provider, p.model])
const url = '/api/workbench/prefs/reviewer'
export const loadReviewers = () => getJson(reviewerView, url)
export const saveReviewer = (reviewer: ReviewerPin | null, csrfToken: string) =>
  sendJson(reviewerView, url, { method: 'PUT', csrfToken, body: { reviewer } })

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
export const branchLink = z.object({
  run_id: z.uuid(),
  request_id: z.uuid(),
  case_id: z.string().min(1).max(64),
  repetition: z.coerce.number().int().min(1).max(10),
  step: z.string().min(1).max(128),
  scope_digest: digest,
  review_digest: digest,
})
export type BranchLink = z.infer<typeof branchLink>
const routeView = z.object({
  review_digest: digest,
  artifact: z.uuid(),
  version: z.number().int(),
  revision: z.number().int(),
  confirmed: digest.nullable(),
  recommended: digest.nullable(),
  gap: z.string().nullable(),
  requirement: z.enum(['isolated_reviewer', 'different_model_family']),
  planned_producer: z.object({ provider: z.string(), model: z.string() }).nullable(),
  verified_producer: z
    .object({ provider: z.string(), model: z.string(), family: z.string() })
    .optional(),
  handoff: z.record(z.string(), digest),
  deferred: z.object({ assessment_output: z.string(), assessment_digest: digest }).nullable(),
  rounds: z.number().int(),
  isolated_execution_available: z.boolean(),
  execution: z
    .union([
      z.object({ unavailable: z.enum(['routeNotLoaded', 'executorUnavailable']) }),
      z.object({
        sealed_findings: z
          .object({
            id: z.uuid(),
            version: z.number().int().positive(),
            digest: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .nullish(),
        task_id: z.uuid(),
        session_id: z.uuid(),
        project_id: z.uuid(),
        state: z.string(),
      }),
      z.object({
        sessions: z.array(z.object({ id: z.uuid(), title: z.string().nullable() })),
        sources: z.array(
          z.object({ source_id: z.uuid(), version: z.number().int(), digest, name: z.string() }),
        ),
      }),
    ])
    .nullish(),
  options: z.array(reviewerOption.extend({ digest, maximum: z.string() })),
})
export async function branchRoute(
  link: BranchLink,
  csrfToken: string,
  confirm?: { previous_revision: number; option_digest: string },
) {
  const { run_id, ...scope } = link
  const response = await sendJson(
    routeView,
    '/api/workbench/reviews/' +
      encodeURIComponent(run_id) +
      (confirm ? '/route' : '/route-preview'),
    { csrfToken, method: confirm ? 'PUT' : 'POST', body: { ...scope, ...confirm } },
  )
  if (response.review_digest !== scope.review_digest) throw new Error('review changed')
  return response
}

export async function startReview(
  link: BranchLink,
  csrfToken: string,
  selection: {
    session_id: string
    source_id: string
    version: number
    digest: string
    revision: number
    option_digest: string
  },
) {
  const { run_id, ...scope } = link
  return sendJson(
    z.object({ task_id: z.uuid(), state: z.string() }),
    '/api/workbench/reviews/' + encodeURIComponent(run_id) + '/execution',
    {
      csrfToken,
      method: 'POST',
      body: { ...scope, ...selection },
    },
  )
}

const decisionItem = z.object({
  artifact_id: z.uuid(),
  quote: z.string(),
  decision: z.enum(['accepted', 'declined', 'deferred']),
  reason: z.string(),
})
const decisionView = z.object({
  review_digest: digest,
  reports: z.array(
    z.object({
      id: z.uuid(),
      version: z.number().int(),
      step: z.enum(['direct', 'review-comparison']),
      text: z.string(),
    }),
  ),
  revision: z.number().int(),
  missing_stages: z.array(z.enum(['direct', 'review-comparison'])),
  task_state: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED']),
  latest_revision: z.number().int(),
  items: z.array(decisionItem),
})
export type DecisionItem = z.infer<typeof decisionItem>
export type DecisionView = z.infer<typeof decisionView>
const decisionUrl = (task: string) =>
  '/api/workbench/tasks/' + encodeURIComponent(task) + '/review-decisions'
export const reviewDecisions = (task: string, revision?: number) =>
  getJson(decisionView, decisionUrl(task) + (revision ? '?revision=' + revision : ''))
export const saveDecisions = (
  task: string,
  csrfToken: string,
  body: {
    previous_revision: number
    review_digest: string
    items: DecisionItem[]
  },
) => sendJson(decisionView, decisionUrl(task), { method: 'PUT', csrfToken, body })
