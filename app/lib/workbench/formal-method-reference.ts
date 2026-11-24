import { z } from 'zod'

export const formalMethodReferenceSchema = z
  .object({
    method_id: z.uuid(),
    version: z.number().int().min(1),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict()

export type MethodReference = z.infer<typeof formalMethodReferenceSchema>

export const formalMethodSelectionsSchema = z
  .array(formalMethodReferenceSchema)
  .max(20)
  .refine((refs) => new Set(refs.map((ref) => ref.method_id)).size === refs.length)
