import { z } from 'zod'

export type MethodKind = '' | 'tool' | 'expert'
export type Facet = { kind: MethodKind; group: string; category: string }
export const allMethods: Facet = { kind: '', group: '', category: '' }
export const directoryBrowseSchema = z.object({
  items: z.array(
    z.object({
      method_id: z.uuid(),
      latest_version: z.number().int().positive(),
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      method_kind: z.enum(['tool', 'expert']),
      title: z.string(),
      summary: z.string(),
      usable: z.boolean(),
      category: z.string(),
    }),
  ),
  total: z.number().int().nonnegative(),
  next: z.number().int().nonnegative().nullable(),
  categories: z.array(
    z.object({
      code: z.string(),
      group: z.string(),
      name: z.string(),
      group_name: z.string(),
      count: z.number().optional(),
    }),
  ),
})
