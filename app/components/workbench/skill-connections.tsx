'use client'

import { useTranslations } from 'next-intl'
import type { SkillDependency } from '@/lib/workbench/capabilities'

export function SkillConnections({ dependencies }: { dependencies?: SkillDependency[] }) {
  const t = useTranslations('capabilities')
  if (!dependencies?.length) return null
  return (
    <ul className="space-y-2 text-sm">
      {dependencies.map((dependency, index) => (
        <li
          key={`${dependency.service_url}-${dependency.tool_name}-${index}`}
          className="rounded border p-2"
        >
          <p className="break-all">{dependency.tool_name || t('dependencyUnknownTool')}</p>
          {dependency.service_url ? (
            <p className="text-muted-foreground text-xs break-all">{dependency.service_url}</p>
          ) : null}
          <p>{t(`dependencyStatus.${dependency.status}`)}</p>
          {dependency.candidates.map((candidate) => (
            <p key={candidate.key} className="text-muted-foreground text-xs break-all">
              {candidate.connection_name} · {candidate.account_label} ·{' '}
              {t.has(`state.${candidate.status}`)
                ? t(`state.${candidate.status}`)
                : candidate.status}
            </p>
          ))}
        </li>
      ))}
    </ul>
  )
}
