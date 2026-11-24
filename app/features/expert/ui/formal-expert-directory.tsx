'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/lib/workbench/context'
import { browsePlanningDirectory } from '@/lib/workbench/method-skill-center'
import { routes } from '@/lib/workbench/routes'

export function FormalExpertDirectory() {
  const { csrfToken, locale } = useWorkbench()
  const t = useTranslations('expertHome')
  const nav = useTranslations('methodSkillCenter')
  const [pages, setPages] = useState([0])
  const offset = pages[pages.length - 1]
  const query = useQuery({
    queryKey: ['formal-expert-directory', offset],
    queryFn: () =>
      browsePlanningDirectory(
        { kind: 'expert', group: '', category: '' },
        offset,
        { stage: 'directory' },
        csrfToken,
      ),
  })
  if (query.isPending) return <p>{t('loading')}</p>
  if (query.isError) return <p role="alert">{t('directoryFailed')}</p>
  const next = query.data.next
  return (
    <div className="space-y-3">
      {query.data.items.length === 0 && <p>{t('emptyFormal')}</p>}
      {query.data.items.map((m) => {
        const ref = { method_id: m.method_id, version: m.latest_version, digest: m.digest }
        const params = new URLSearchParams({ mode: 'expert', formalReference: JSON.stringify(ref) })
        return (
          <article className="rounded-xl border p-4" key={m.method_id + ':' + m.latest_version}>
            <h3>
              {m.title} · v{m.latest_version}
            </h3>
            <p>{m.summary}</p>
            {m.usable && (
              <Link href={routes.home(locale) + '?' + params} className="underline">
                {t('ask')}
              </Link>
            )}
          </article>
        )
      })}
      {pages.length > 1 && (
        <Button onClick={() => setPages((p) => p.slice(0, -1))}>{nav('previousPage')}</Button>
      )}
      {next !== null && (
        <Button onClick={() => setPages((p) => [...p, next])}>{nav('nextPage')}</Button>
      )}
    </div>
  )
}
