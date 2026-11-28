import { z } from 'zod'

const uuid = z.uuid()
const dateTime = z.iso.datetime({ offset: true })

export const runStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_input',
  'succeeded',
  'failed',
  'cancelled',
])

export const citationSchema = z
  .object({
    contract_version: z.literal(1),
    evidence_id: uuid,
    knowledge_document_id: uuid,
    knowledge_document_version_id: uuid,
    chunk_id: uuid,
    title: z.string().max(4096).nullable(),
    quote: z.string().min(1).max(1000),
    source_document_id: uuid,
    source_document_version_id: uuid,
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    source_href: z
      .string()
      .max(160)
      .regex(/^\/api\/web\/v1\/citations\/[0-9a-fA-F-]{36}\/source$/),
  })
  .strict()
  .refine(
    (citation) =>
      citation.source_href.toLowerCase() ===
      `/api/web/v1/citations/${citation.evidence_id}/source`.toLowerCase(),
    'source_href must identify evidence_id',
  )

export const requiredActionSchema = z
  .object({
    action_id: uuid,
    kind: z.enum(['confirmation', 'input']),
    prompt: z.string().min(1).max(2000),
  })
  .strict()

export const runSnapshotSchema = z
  .object({
    contract_version: z.literal(1),
    run_id: uuid,
    title: z.string().min(1).max(512),
    status: runStatusSchema,
    summary: z.string().max(20000).nullable(),
    last_sequence_no: z.number().int().nonnegative(),
    last_event_id: uuid.nullable(),
    citations: z.array(citationSchema).max(50),
    required_action: requiredActionSchema.nullable(),
    updated_at: dateTime,
  })
  .strict()
  .refine(
    (snapshot) =>
      new Set(snapshot.citations.map((citation) => citation.evidence_id)).size ===
      snapshot.citations.length,
    'citation evidence_id values must be unique',
  )

const eventBase = {
  contract_version: z.literal(1),
  event_id: uuid,
  run_id: uuid,
  sequence_no: z.number().int().positive(),
  occurred_at: dateTime,
}

export const runEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('status'), data: z.object({ status: runStatusSchema }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal('delta'), data: z.object({ text: z.string().min(1).max(4096) }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal('citation'), data: z.object({ citation: citationSchema }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal('input_required'), data: z.object({ action: requiredActionSchema }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal('completed'), data: z.object({ summary: z.string().max(20000) }).strict() }).strict(),
  z.object({
    ...eventBase,
    type: z.literal('failed'),
    data: z.object({ code: z.string().min(1).max(128), message: z.string().min(1).max(1000) }).strict(),
  }).strict(),
  z.object({ ...eventBase, type: z.literal('heartbeat'), data: z.object({}).strict() }).strict(),
])

export const runActionSchema = z
  .object({
    contract_version: z.literal(1),
    action_id: uuid,
    value: z.string().max(4000),
  })
  .strict()

export const createRunRequestSchema = z
  .object({
    contract_version: z.literal(1),
    idempotency_key: uuid,
    title: z.string().min(1).max(512).nullable().optional(),
    input: z
      .object({
        text: z.string().min(1).max(20000),
      })
      .strict(),
  })
  .strict()

export const cancelRunRequestSchema = z
  .object({
    contract_version: z.literal(1),
    idempotency_key: uuid,
    reason: z.string().max(1000).nullable().optional(),
  })
  .strict()

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(1000),
        operation_id: z.string().min(1).max(128),
      })
      .strict(),
  })
  .strip()

export type Citation = z.infer<typeof citationSchema>
export type RunSnapshot = z.infer<typeof runSnapshotSchema>
export type RunEvent = z.infer<typeof runEventSchema>
export type RunAction = z.infer<typeof runActionSchema>
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>
export type CancelRunRequest = z.infer<typeof cancelRunRequestSchema>
