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
export const reviewerKey = ['reviewer-preference'] as const
export const loadReviewers = () => getJson(reviewerView, url)
export const saveReviewer = (reviewer: ReviewerPin | null, csrfToken: string) =>
  sendJson(reviewerView, url, { method: 'PUT', csrfToken, body: { reviewer } })
