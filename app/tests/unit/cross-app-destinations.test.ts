import { describe, expect, it } from 'vitest'

import { destinations } from '@/lib/cross-app/destinations'

describe('where knowbench takes people', () => {
  it('registers formal-first KnowLab studio/methods, KnowMart catalog/formal/demands, and KnowBase direct upload', () => {
    expect(destinations).toEqual({
      'knowlab.studio': { target: 'knowlab', segments: ['studio'] },
      'knowlab.studioNew': {
        target: 'knowlab',
        segments: ['studio'],
        params: [
          'archetype',
          'method_kind',
          'source_kind',
          'source_id',
          'source_version',
          'source_name',
          'handoff_task',
        ],
      },
      'knowlab.methods': {
        target: 'knowlab',
        segments: ['methods'],
        params: ['method_id', 'version'],
      },
      'knowlab.studioDraft': { target: 'knowlab', segments: ['studio', ':method'], params: ['version'] },
      'knowmart.shop': { target: 'knowmart', segments: ['shop'] },
      'knowmart.knowbots': { target: 'knowmart', segments: ['knowbots'] },
      'knowmart.formalDetail': {
        target: 'knowmart',
        segments: ['knowbots', 'formal', ':listing_id'],
      },
      'knowmart.demands': {
        target: 'knowmart',
        segments: ['publish', 'expert'],
        params: ['title', 'problem'],
      },
      'knowbase.upload': {
        target: 'knowbase',
        segments: ['upload'],
        params: ['doc_type', 'subject', 'period_start', 'period_end', 'disclosed_on', 'edition'],
      },
    })
  })
})
