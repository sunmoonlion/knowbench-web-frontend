import { z } from 'zod'
import { formalMethodReferenceSchema as pin } from '@/lib/workbench/formal-method-reference'
import { getJson, seg, sendJson } from '@/lib/workbench/http'

export const readExpertEntry = () =>
  getJson(z.object({ unified: z.boolean() }), '/api/workbench/expert/entry')

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
const handoffReceipt = z.object({
  request_id: z.uuid(),
  mode: z.enum(['new', 'author_revision', 'user_demand']),
  review_digest: z.string(),
})
const suggestion = z.object({ sketch_digest: z.string(), methods: z.array(pin), outputs: names })
const feedback = z.object({
  review_digest: z.string(),
  handoff: handoffReceipt.nullable().optional(),
  handoff_gap: z.string().nullable().optional(),
  handoff_reference: pin.nullable().optional(),
  suggested_plan: suggestion.nullable().optional(),
  attached_plan: z.boolean().optional(),
})
export type Feedback = z.infer<typeof feedback>

const reviewed = z.object({
  task_id: z.uuid(),
  project_id: z.string(),
  question: z.string(),
  state: z.string(),
  followup: z
    .object({
      kind: z.enum(['duty', 'handoff']),
      origin: z.uuid(),
      released: z
        .object({
          output: z.string(),
          material: z.object({ material_id: z.uuid(), version_no: z.number(), sha256: z.string() }),
        })
        .optional(),
    })
    .optional(),
  superseded_by: z.uuid().optional(),
  feedback: feedback.optional(),
  duty_material_slots: z.array(z.string()).optional(),
  temporary_delivery: z.boolean().optional(),
  execution_state: z.string().optional(),
  delivery: z.record(z.string(), z.json()).nullable().optional(),
  execution: z.object({ task_id: z.uuid() }).optional(),
  session_id: z.uuid().optional(),
  error: z.string().optional(),
  formal: z
    .object({
      review_digest: z.string(),
      more: z.boolean(),
      source: z.literal('empty_directory').optional(),
      suggested_plan: suggestion.nullable().optional(),
      attached_plan: z.boolean().optional(),
      handoff: handoffReceipt.nullable().optional(),
      handoff_reference: pin.nullable().optional(),
      handoff_gap: z.string().nullable().optional(),
      planning_available: z.boolean().default(false),
      ended: z.boolean().default(false),
      selected: pin.nullable(),
      scope_preview: scope.nullable(),
      options: z.array(entry),
      match: z.object({
        outcome: z.enum(['candidates', 'clarify', 'no_match']).optional(),
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
    body: {
      ...body,
      retain_empty: true,
      budget_limit: '2',
      match_contract: 'knowbench/expert-match/v5',
    },
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

const partialOption = z.object({
  object_id: z.string().optional(),
  artifact: z.object({ step_id: z.string(), version: z.number(), digest: z.string() }),
  output_names: z.array(z.string()),
  applicable_promises: z.array(z.string()),
})
const partialResponse = z.object({
  report: z
    .object({
      scope_digest: z.string(),
      options: z.array(partialOption),
      missing_steps: z.array(z.string()),
      missing_objects: z.array(z.string()).optional(),
      promises: z.record(z.string(), z.string()),
      received: z.array(z.object({ step: z.string(), outputs: z.record(z.string(), z.json()) })),
    })
    .nullable(),
})

const partialPath = (task: string) => `/api/workbench/tasks/${seg(task)}/partial-delivery`
export const readPartial = (task: string) => getJson(partialResponse, partialPath(task))
export const receivePartial = (
  task: string,
  csrfToken: string,
  body: { step: string; scope_digest: string },
) => sendJson(partialResponse, partialPath(task), { method: 'PUT', csrfToken, body })

export const endUnmatched = (task: string, csrfToken: string, review_digest: string) =>
  sendJson(z.object({ review_digest: z.string() }), `/api/workbench/find-expert/${seg(task)}/end`, {
    method: 'PUT',
    csrfToken,
    body: { review_digest },
  })

export const sendHandoff = (
  task: string,
  csrfToken: string,
  review_digest: string,
  gap: string,
  reference: z.infer<typeof pin> | null,
  plan_digest?: string,
) =>
  sendJson(handoffReceipt, `/api/workbench/find-expert/${seg(task)}/handoff`, {
    method: 'PUT',
    csrfToken,
    body: { review_digest, gap, reference, plan_digest },
  })
export type FormalReview = NonNullable<z.infer<typeof reviewed>['formal']>

const materialPin = z.object({
  material_id: z.uuid(),
  version_no: z.number().int().positive(),
  sha256: z.string(),
})
const probeReceipt = z.object({
  consent: z.string(),
  result: materialPin.extend({
    sheet: z.string(),
    column: z.string(),
    status: z.enum(['present', 'missing', 'unknown']),
  }),
})
const sketchStep = z.object({
  id: z.string(),
  method: z.string(),
  task: z.string(),
  inputs: z.record(
    z.string(),
    z.object({
      source: z.string(),
      name: z.string().optional(),
      step: z.string().optional(),
      output: z.string().optional(),
    }),
  ),
  cases: z.record(z.string(), z.string()),
  route_input: z.string().nullable(),
  reviews: z.array(z.string()),
})
const sketch = z.object({
  selection: z
    .object({
      steps: z.array(sketchStep),
      object_batch: z.object({ max_objects: z.number() }).nullable(),
    })
    .optional(),
  aliases: z.record(z.string(), pin).optional(),
  method_titles: z.record(z.string(), z.string()).optional(),
  patterns: z.array(z.enum(['P1', 'P2', 'P3', 'P4', 'P5'])).optional(),
  routing_alternatives: z.array(z.string()).optional(),
  probe: probeReceipt.optional(),
  runtime: z.object({ patterns: z.record(z.string(), z.boolean()) }).optional(),
  required_capabilities: z.array(z.string()).optional(),
  missing: z.array(z.string()).optional(),
  outcome: z.enum(['idle', 'planning', 'plan', 'adopted', 'clarify', 'gap']),
  explanation: z.string().optional(),
  search_goal: z.string().nullable().optional(),
  remaining_rounds: z.number().int().optional(),
  planning_task: z.uuid().nullable().optional(),
  scope: scope.optional(),
  sketch_digest: z.string().optional(),
  saved: z.boolean().optional(),
  partial: z.boolean().optional(),
})
export type TemporarySketch = z.infer<typeof sketch>
export type PlanReview = {
  confirmed: true
  routing_required: boolean
  cases: Record<string, string[]>
  step_text: Record<string, string>
}
const sketchPath = (task: string) => `/api/workbench/find-expert/${seg(task)}/temporary-plan`
export const readSketch = (task: string) => getJson(sketch, sketchPath(task))
export const requestSketch = (
  task: string,
  csrfToken: string,
  review_digest: string,
  clarification: string,
  previous?: string | null,
  probe_digest?: string,
) =>
  sendJson(sketch, sketchPath(task), {
    method: 'PUT',
    csrfToken,
    body: { review_digest, clarification, previous, probe_digest },
  })
export const adoptSketch = (
  task: string,
  csrfToken: string,
  review_digest: string,
  sketch_digest: string,
  source_task?: string,
  review?: PlanReview,
) =>
  sendJson(scope, sketchPath(task) + '/adoption', {
    method: 'PUT',
    csrfToken,
    body: { review_digest, sketch_digest, source_task, review },
  })
export const saveSketch = (task: string, csrfToken: string, review_digest: string) =>
  sendJson(
    z.object({ source_task: z.uuid(), sketch_digest: z.string() }),
    sketchPath(task) + '/saved',
    { method: 'PUT', csrfToken, body: { review_digest } },
  )

export const listProbeMaterials = (task: string, digest: string) =>
  getJson(
    z.object({
      materials: z.array(materialPin.extend({ name: z.string() })),
    }),
    sketchPath(task) + '/materials?review_digest=' + encodeURIComponent(digest),
  )
export const checkPlanningColumn = (
  task: string,
  csrfToken: string,
  review_digest: string,
  planning_task: string,
  material: z.infer<typeof materialPin>,
  sheet: string,
  column: string,
) =>
  sendJson(probeReceipt, sketchPath(task) + '/probe', {
    method: 'PUT',
    csrfToken,
    body: {
      review_digest,
      planning_task,
      material_id: material.material_id,
      version_no: material.version_no,
      sha256: material.sha256,
      sheet,
      column,
    },
  })

const duty = z.object({
  origin: z.uuid(),
  current_match: z.uuid(),
  paused: z.boolean(),
  next_at: z.string(),
  problem: z.string().nullable(),
  config: z.object({
    reference: pin,
    instruction: z.string(),
    interval_hours: z.number(),
    output: z.string(),
  }),
  approved: z.object({ execution: z.uuid() }).nullable(),
})
const taskPath = (task: string) => `/api/workbench/find-expert/${seg(task)}`
export const readDuty = (task: string) => getJson(duty.nullable(), taskPath(task) + '/duty')
export const changeDuty = (
  task: string,
  action: '' | '/state' | '/output' | '/withdrawal',
  csrfToken: string,
  body: Record<string, unknown>,
) => sendJson(duty, taskPath(task) + '/duty' + action, { method: 'PUT', csrfToken, body })
export const readHandoffVersions = (task: string) =>
  getJson(
    z.object({
      previous: entry.nullable(),
      options: z.array(
        z.object({
          candidate: entry,
          review_digest: z.string(),
          changes: z.record(z.string(), z.object({ before: z.json(), after: z.json() })),
        }),
      ),
      adopted: z.array(z.object({ reference: pin, task_id: z.uuid() })),
    }),
    taskPath(task) + '/handoff/versions',
  )
export const adoptVersion = (
  task: string,
  csrfToken: string,
  reference: z.infer<typeof pin>,
  review_digest: string,
) =>
  sendJson(z.object({ task_id: z.uuid() }), taskPath(task) + '/handoff/versions', {
    method: 'PUT',
    csrfToken,
    body: { reference, review_digest },
  })
