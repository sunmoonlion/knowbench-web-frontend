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
