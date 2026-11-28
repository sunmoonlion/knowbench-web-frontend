import type { RunEvent, RunSnapshot } from '@/contracts/interaction'

export type RunProjection = {
  snapshot: RunSnapshot
  citations: RunSnapshot['citations']
  seenEventIds: ReadonlySet<string>
}

export type ProjectionResult =
  | { kind: 'applied'; projection: RunProjection }
  | { kind: 'duplicate'; projection: RunProjection }
  | { kind: 'gap'; projection: RunProjection; expected: number; received: number }
  | { kind: 'foreign_run'; projection: RunProjection }

export function createRunProjection(snapshot: RunSnapshot, previous?: RunProjection | null): RunProjection {
  const citations = previous?.snapshot.run_id === snapshot.run_id
    ? Array.from(new Map([...previous.citations, ...snapshot.citations].map(c => [c.evidence_id, c])).values())
    : snapshot.citations
  return {
    snapshot,
    citations,
    seenEventIds: new Set(snapshot.last_event_id ? [snapshot.last_event_id] : []),
  }
}

export function applyRunEvent(projection: RunProjection, event: RunEvent): ProjectionResult {
  if (event.run_id !== projection.snapshot.run_id) {
    return { kind: 'foreign_run', projection }
  }
  if (
    projection.seenEventIds.has(event.event_id) ||
    event.sequence_no <= projection.snapshot.last_sequence_no
  ) {
    return { kind: 'duplicate', projection }
  }
  const expected = projection.snapshot.last_sequence_no + 1
  if (event.sequence_no !== expected) {
    return { kind: 'gap', projection, expected, received: event.sequence_no }
  }

  const snapshot: RunSnapshot = {
    ...projection.snapshot,
    last_sequence_no: event.sequence_no,
    last_event_id: event.event_id,
    updated_at: event.occurred_at,
  }
  if (event.type === 'status') {
    snapshot.status = event.data.status
    if (snapshot.status !== 'waiting_for_input') snapshot.required_action = null
  }
  if (event.type === 'delta') {
    snapshot.summary = `${snapshot.summary ?? ''}${event.data.text}`.slice(0, 20000)
  }
  let citations = projection.citations
  if (event.type === 'citation' && !citations.some(c => c.evidence_id === event.data.citation.evidence_id)) {
    citations = [...citations, event.data.citation]
    snapshot.citations = citations.slice(0, 50)
  }
  if (event.type === 'input_required') {
    snapshot.status = 'waiting_for_input'
    snapshot.required_action = event.data.action
  }
  if (event.type === 'completed') {
    snapshot.status = 'succeeded'
    snapshot.summary = event.data.summary
    snapshot.required_action = null
  }
  if (event.type === 'failed') {
    snapshot.status = 'failed'
    snapshot.summary = event.data.message
    snapshot.required_action = null
  }

  return {
    kind: 'applied',
    projection: {
      snapshot,
      citations,
      seenEventIds: new Set([...projection.seenEventIds, event.event_id]),
    },
  }
}
