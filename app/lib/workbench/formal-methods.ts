import { z } from 'zod'
import { accessRequirementSchema, callSchema, capabilityCallStatusSchema } from './capabilities'
import { getJson, sendJson, seg, WorkbenchError } from './http'

const jsonObject = z.record(z.string(), z.json())
export const formalMethodReferenceSchema = z
  .object({
    method_id: z.uuid(),
    version: z.number().int().min(1),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict()
const slot = z
  .object({
    description: z.string(),
    schema: jsonObject,
    required: z.boolean(),
    meaning: z.record(z.string(), z.string()),
    on_missing: z.enum(['pause', 'fail', 'omit']),
  })
  .strict()
export const formalMethodCatalogItemSchema = z
  .object({
    reference: formalMethodReferenceSchema,
    title: z.string(),
    purpose: z.string(),
    inputs: z.record(z.string(), slot),
    outputs: z.record(z.string(), slot),
    access_requirements: z.array(accessRequirementSchema),
    uncovered: z.array(
      z.object({ scenario: z.string(), reason: z.string(), scope: z.string() }).strict(),
    ),
    available: z.boolean(),
    issue: z.string().nullable(),
  })
  .strict()
export const formalMethodInvocationSchema = z
  .object({
    request_id: z.uuid(),
    method_call_id: z.uuid(),
    reference: formalMethodReferenceSchema,
    title: z.string(),
    status: capabilityCallStatusSchema,
    call: callSchema,
    outputs: jsonObject.nullable(),
    detail: z.string(),
  })
  .strict()
  .refine(
    (value) =>
      value.call.detail.execution_kind === 'formal_method' &&
      value.method_call_id !== value.call.id &&
      (value.status === value.call.status ||
        (value.status === 'failed' && value.call.status === 'succeeded')) &&
      (value.status === 'succeeded'
        ? value.call.status === 'succeeded' && value.outputs !== null
        : value.outputs === null),
  )
export const formalMethodCatalogSchema = z
  .object({ items: z.array(formalMethodCatalogItemSchema) })
  .strict()
export const formalMethodInvocationsSchema = z
  .object({ calls: z.array(formalMethodInvocationSchema).max(50) })
  .strict()
export const formalMethodValuesSchema = jsonObject.refine((value) => {
  const bounded = (item: unknown, depth: number): boolean =>
    depth <= 32 &&
    (item === null ||
      typeof item !== 'object' ||
      Object.values(item).every((child) => bounded(child, depth + 1)))
  return (
    Object.keys(value).length <= 100 &&
    bounded(value, 0) &&
    new TextEncoder().encode(JSON.stringify(value)).length <= 64000
  )
})
export const formalMethodInvokeSchema = z
  .object({
    request_id: z.uuid(),
    reference: formalMethodReferenceSchema,
    values: formalMethodValuesSchema,
  })
  .strict()
export type FormalMethodCatalogItem = z.infer<typeof formalMethodCatalogItemSchema>
export type FormalMethodInvocation = z.infer<typeof formalMethodInvocationSchema>
export type FormalMethodInvoke = z.infer<typeof formalMethodInvokeSchema>
const base = (session: string) => `/api/workbench/sessions/${seg(session)}`
const path = (session: string) => `${base(session)}/formal-method-calls`
export const formalReferenceKey = (reference: FormalMethodCatalogItem['reference']) =>
  `${reference.method_id}:${reference.version}:${reference.digest}`
function checked(
  value: FormalMethodInvocation,
  session: string,
  request?: Pick<FormalMethodInvoke, 'request_id'> & Partial<Pick<FormalMethodInvoke, 'reference'>>,
) {
  if (
    value.call.session_id !== session ||
    (request &&
      (value.request_id !== request.request_id ||
        (request.reference &&
          formalReferenceKey(value.reference) !== formalReferenceKey(request.reference))))
  )
    throw new WorkbenchError('contract_invalid')
  return value
}
export async function formalMethodCatalog(session: string) {
  const value = await getJson(formalMethodCatalogSchema, `${base(session)}/formal-methods`)
  if (
    new Set(value.items.map((item) => formalReferenceKey(item.reference))).size !==
    value.items.length
  )
    throw new WorkbenchError('contract_invalid')
  return value.items
}
export async function formalMethodInvocations(session: string) {
  const value = await getJson(formalMethodInvocationsSchema, path(session))
  if (new Set(value.calls.map((call) => call.request_id)).size !== value.calls.length)
    throw new WorkbenchError('contract_invalid')
  return value.calls.map((call) => checked(call, session))
}
export async function formalMethodInvocation(
  session: string,
  request: Pick<FormalMethodInvoke, 'request_id'> & Partial<Pick<FormalMethodInvoke, 'reference'>>,
) {
  return checked(
    await getJson(formalMethodInvocationSchema, `${path(session)}/${seg(request.request_id)}`),
    session,
    request,
  )
}
export async function invokeFormalMethod(
  session: string,
  command: FormalMethodInvoke,
  csrfToken: string,
) {
  const body = formalMethodInvokeSchema.parse(command)
  return checked(
    await sendJson(formalMethodInvocationSchema, path(session), { body, csrfToken }),
    session,
    body,
  )
}
