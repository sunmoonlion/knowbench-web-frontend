'use client'
import { useTranslations } from 'next-intl'
import type { Facet, MethodKind, directoryBrowseSchema } from '@/lib/directory-facets'
import type { z } from 'zod'

export function DirectoryFacets({
  value,
  change,
  categories = [],
  total,
  shared = false,
}: {
  value: Facet
  change: (facet: Facet) => void
  categories?: z.infer<typeof directoryBrowseSchema>['categories']
  total?: number
  shared?: boolean
}) {
  const t = useTranslations('directoryFacets')
  const groups = Array.from(new Map(categories.map((c) => [c.group, c.group_name])).entries())
  const children = categories.filter((c) => c.group === value.group && c.code !== value.group)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label>
        {t('kind')}{' '}
        <select
          value={value.kind}
          onChange={(e) => change({ kind: e.target.value as MethodKind, group: '', category: '' })}
        >
          <option value="">{t('all')}</option>
          <option value="tool">{t('tool')}</option>
          {!shared && <option value="expert">{t('expert')}</option>}
        </select>
      </label>
      {value.kind && (
        <label>
          {t('group')}{' '}
          <select
            value={value.group}
            onChange={(e) => change({ ...value, group: e.target.value, category: '' })}
          >
            <option value="">{t('all')}</option>
            {groups.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {children.length > 0 && (
        <label>
          {t('category')}{' '}
          <select
            value={value.category}
            onChange={(e) => change({ ...value, category: e.target.value })}
          >
            <option value="">{t('all')}</option>
            {children.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {value.kind && total !== undefined && <span>{t('count', { count: total })}</span>}
    </div>
  )
}
