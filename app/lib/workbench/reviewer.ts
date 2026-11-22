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
  handoff: z.record(z.string(), digest),
  deferred: z.object({ assessment_output: z.string(), assessment_digest: digest }).nullable(),
  rounds: z.number().int(),
  isolated_execution_available: z.literal(false),
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
