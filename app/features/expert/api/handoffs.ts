import { z } from 'zod'
import { getJson, seg, sendJson } from '@/lib/workbench/http'

const decision = z.object({
  child_call_id: z.uuid(),
  evidence_digest: z.string(),
  decision: z.enum(['accept', 'decline', 'defer']),
  reason: z.string(),
  next_owner: z.string().nullable(),
})
const command = z.object({
  parent_call_id: z.uuid(),
  scope_digest: z.string(),
  residual: z.string().nullable(),
  decisions: z.array(decision),
})
const artifact = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.number(),
  digest: z.string(),
})
const round = z.object({
  request: z.object({
    role: z.array(z.string()),
    goal: z.string(),
    attempt_id: z.uuid().nullable(),
    reference: z.object({ method_id: z.uuid(), version: z.number(), digest: z.string() }),
    input_digest: z.string(),
    inputs: z.array(artifact),
  }),
  receipts: z.array(
    z.object({
      state: z.string(),
      artifacts: z.array(artifact),
      failure: z.string().nullable(),
      executor: z.record(z.string(), z.string()),
      cost: z.string().nullable(),
      cost_pending: z.boolean().optional(),
    }),
  ),
  late: z.array(z.object({ status: z.string(), operation_call_id: z.uuid() })),
})
const parent = z.object({
  parent_call_id: z.uuid(),
  scope_digest: z.string(),
  can_close: z.boolean(),
  missing: z.array(z.array(z.string())),
  children: z.array(
    z.object({
      child_call_id: z.uuid(),
      rounds: z.array(round),
      state: z.string(),
      evidence_digest: z.string(),
    }),
  ),
  closure: z.object({ closed_at: z.string(), writer: z.string(), command }).nullable(),
})
const view = z.object({ parents: z.array(parent) })
export type HandoffParent = z.infer<typeof parent>
export type HandoffCommand = z.infer<typeof command>
const path = (task: string) => `/api/workbench/tasks/${seg(task)}/handoffs`
export const readHandoffs = (task: string) => getJson(view, path(task))
export const closeHandoffs = (task: string, csrfToken: string, body: HandoffCommand) =>
  sendJson(view, path(task), { method: 'PUT', csrfToken, body })

export const readHandoffEvidence = (task: string, child: string, id: string) =>
  getJson(
    z.object({ outputs: z.record(z.string(), z.json()) }),
    path(task) + '/' + seg(child) + '/artifacts/' + seg(id),
  )
