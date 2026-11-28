'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { useMemories, useMemoryActions } from '../api/memory'

// 长期记忆：一张清单。每条可停用、改、删；顶部一句说明它会放进每段对话的开头。
export function MemoryScreen() {
  const t = useTranslations('memory')
  const memories = useMemories()
  const act = useMemoryActions()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const busy =
    act.add.isPending || act.change.isPending || act.remove.isPending || act.clear.isPending
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('intro')}</p>
        </header>

        <section aria-label={t('addTitle')} className="space-y-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            maxLength={400}
            aria-label={t('addLabel')}
            placeholder={t('addPlaceholder')}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() =>
                act.add.mutate(draft.trim(), {
                  onSuccess: () => setDraft((current) => (current === draft ? '' : current)),
                })
              }
            >
              {t('add')}
            </Button>
            <span className="text-muted-foreground text-xs">{t('examples')}</span>
          </div>
        </section>

        <section aria-label={t('listTitle')}>
          {memories.isError ? (
            <p role="alert">
              {t('readFailed')}{' '}
              <button type="button" onClick={() => void memories.refetch()}>
                {t('retry')}
              </button>
            </p>
          ) : memories.isPending ? (
            <p className="text-muted-foreground text-sm">{t('loading')}</p>
          ) : (memories.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {(memories.data ?? []).map((memory) => (
                <li key={memory.id} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={memory.enabled}
                    aria-label={t('enabled')}
                    disabled={busy}
                    onChange={(event) =>
                      act.change.mutate({ id: memory.id, enabled: event.target.checked })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    {editing?.id === memory.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editing.text}
                          onChange={(event) =>
                            setEditing({ id: memory.id, text: event.target.value })
                          }
                          rows={2}
                          maxLength={400}
                          aria-label={t('editLabel')}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busy || !editing.text.trim()}
                            onClick={() =>
                              act.change.mutate(
                                { id: memory.id, text: editing.text.trim() },
                                {
                                  onSuccess: () =>
                                    setEditing((current) => (current === editing ? null : current)),
                                },
                              )
                            }
                          >
                            {t('save')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            {t('cancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p
                        className={
                          memory.enabled ? 'text-sm' : 'text-muted-foreground text-sm line-through'
                        }
                      >
                        {memory.text}
                      </p>
                    )}
                  </div>
                  {editing?.id === memory.id ? null : (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setEditing({ id: memory.id, text: memory.text })}
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => act.remove.mutate(memory.id)}
                      >
                        {t('remove')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(memories.data ?? []).length > 0 ? (
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act.clear.mutate()}
              >
                {t('clear')}
              </Button>
            </div>
          ) : null}
          {act.add.isError || act.change.isError || act.remove.isError || act.clear.isError ? (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {t('failed')}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}
