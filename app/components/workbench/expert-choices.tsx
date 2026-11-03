'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { Pack } from '@/contracts/workbench-v2'
import { useRemoveExpert } from '@/lib/workbench/knowbots'
import { cn } from '@/lib/utils'

export function ExpertChoices({
  packs,
  selected,
  onSelect,
  onRemoved,
}: {
  packs: Pack[]
  selected: string | null
  onSelect: (id: string) => void
  onRemoved: (id: string) => void
}) {
  const t = useTranslations('home.expert')
  const remove = useRemoveExpert()
  return (
    <div>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('who')}>
        {packs.map((pack) => (
          <li
            key={pack.id}
            className={cn(
              'flex items-start gap-2 rounded-lg border p-2',
              selected === pack.id && 'border-primary bg-primary/10 ring-primary ring-1',
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 rounded p-1 text-left"
              aria-label={pack.name}
              aria-pressed={selected === pack.id}
              disabled={pack.status === 'preparing'}
              onClick={() => onSelect(pack.id)}
            >
              <span className="block text-sm font-medium">
                {pack.name}
                {pack.status === 'preparing' ? ` · ${t('preparing')}` : ''}
              </span>
              <span className="text-muted-foreground block text-xs">{pack.tagline}</span>
            </button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('removeNamed', { name: pack.name })}
              disabled={remove.isPending}
              onClick={() => remove.mutate(pack.id, { onSuccess: () => onRemoved(pack.id) })}
            >
              {t('remove')}
            </Button>
          </li>
        ))}
      </ul>
      {remove.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t('removeFailed')}
        </p>
      ) : null}
    </div>
  )
}
