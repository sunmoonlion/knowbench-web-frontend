import { expect, it } from 'vitest'
import { splitArtifact, byFile } from '@/lib/workbench/timeline'
import { changeStep, commandStep, dataStep, relativeTo } from '@/lib/workbench/items'
it('preserves the second line of a qualified delivery before a JSON block', () => {
  const result = splitArtifact('对齐金额。\n缺两行数据，仅供自查。\n{"total":100}')
  expect(result).toEqual({ summary: '对齐金额。\n缺两行数据，仅供自查。', raw: '{"total":100}' })
})
it('reports a restored file as modified', () => {
  const file = { path: 'report', added: 0, removed: 1, diff: '-old', how: 'delete' as const }
  expect(byFile([file, { ...file, added: 1, removed: 0, diff: '+new', how: 'add' }])[0].how).toBe(
    'update',
  )
})
it('retains failed command status without exit code', () => {
  expect(commandStep({ id: 'c', status: 'failed', exitCode: null }, false).failed).toBe(true)
})
it('keeps structured results and surfaces a tool-level error', () => {
  const result = dataStep(
    {
      id: 'r',
      status: 'completed',
      result: { content: [], structuredContent: { reason: 'missing' }, isError: true },
    },
    false,
  )
  expect(result).toMatchObject({ failed: true, result: expect.stringContaining('missing') })
})
it('counts actual edits starting with repeated signs inside a hunk', () => {
  const changed = changeStep(
    { changes: [{ path: 'note', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n---old\n+++new' }] },
    false,
  )
  expect(changed.files[0]).toMatchObject({ added: 1, removed: 1 })
})
it('computes a Windows child relative to its project', () => {
  expect(relativeTo('C:\\project', 'C:\\project\\report.md')).toBe('report.md')
})
