'use client'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'
import { DirectoryFacets } from '@/components/common/directory-facets'
import { allMethods } from '@/lib/directory-facets'
import { Button } from '@/components/ui/button'
import { RequestFailure } from '@/components/common/request-failure'
import { useWorkbench } from '@/lib/workbench/context'
import { routes } from '@/lib/workbench/routes'
import type { MethodReference } from '@/lib/workbench/formal-method-reference'
import {
  methodSkillCenterKey,
  browsePlanningDirectory,
  methodSkillCenterPlanningMethods,
  planningDeclaration,
  type PlanningQuery,
} from '@/lib/workbench/method-skill-center'
const panel = 'space-y-3 rounded-xl border p-4'
function CandidateDeclaration({
  reference,
}: {
  reference: Parameters<typeof planningDeclaration>[0]
}) {
  const t = useTranslations('methodSkillCenter')
  const { csrfToken } = useWorkbench()
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: [...methodSkillCenterKey, 'declaration', reference],
    queryFn: () => planningDeclaration(reference, csrfToken),
    enabled: open,
    retry: false,
  })
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('candidateDeclaration')}</summary>
      {open &&
        (query.isError ? (
          <RequestFailure error={query.error} retry={() => void query.refetch()} />
        ) : !query.data || query.isFetching ? (
          <p>{t('loading')}</p>
        ) : (
          <dl>
            <dt>{t('candidatePurpose')}</dt>
            <dd>{query.data.purpose}</dd>
            <dt>{t('candidateApplies')}</dt>
            <dd>{query.data.applies_when.join(' · ')}</dd>
            {query.data.excludes.length > 0 && (
              <>
                <dt>{t('candidateExcludes')}</dt>
                <dd>{query.data.excludes.join(' · ')}</dd>
              </>
            )}
            <dt>{t('candidatePromises')}</dt>
            <dd>
              <ul>
                {Object.entries(query.data.promises).map(([id, text]) => {
                  const condition = query.data.conditions?.[id]
                  return (
                    <li key={id}>
                      <strong>{text}</strong>
                      {condition && (
                        <p>
                          {t('candidateApplies')} · {condition.when}
                        </p>
                      )}
                      {!!condition?.input_slots.length && (
                        <p>
                          {t('promiseInputs')} · {condition.input_slots.join(', ')}
                        </p>
                      )}
                      <p>
                        {t('promiseDeliverables')} · {query.data.outputs[id]?.join(', ')}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </dd>
          </dl>
        ))}
    </details>
  )
}

export function PlanningMethods({
  forQuestion,
  onPick,
}: {
  forQuestion?: string
  onPick?: (item: { reference: MethodReference; title: string }) => void
}) {
  const t = useTranslations('methodSkillCenter')
  const { csrfToken, locale } = useWorkbench()
  const [question, setQuestion] = useState('')
  const [searchBasis, setBasis] = useState<PlanningQuery>({ stage: 'directory' })
  const basis: PlanningQuery =
    forQuestion === undefined ? searchBasis : { stage: 'composition', question: forQuestion }
  const [facet, setFacet] = useState(allMethods)
  const [pages, setPages] = useState([0])
  const offset = pages[pages.length - 1]
  const search = (next: PlanningQuery) => {
    setPages([0])
    setBasis(next)
    setFacet(allMethods)
  }
  const regular = useQuery({
    enabled: !facet.kind,
    queryKey: [...methodSkillCenterKey, 'planning', offset, basis],
    queryFn: () => methodSkillCenterPlanningMethods(offset, basis, csrfToken),
  })
  const filtered = useQuery({
    queryKey: [...methodSkillCenterKey, 'browse', facet, offset, basis],
    enabled: !!facet.kind,
    queryFn: () => browsePlanningDirectory(facet, offset, basis, csrfToken),
  })
  const query = facet.kind ? filtered : regular
  return (
    <div className="space-y-3">
      <DirectoryFacets
        value={facet}
        change={(v) => {
          setFacet(v)
          setPages([0])
        }}
        categories={filtered.data?.categories}
        total={filtered.data?.total}
      />
      {forQuestion === undefined && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (question.trim()) search({ stage: 'expert', question: question.trim() })
          }}
        >
          <label className="block">
            {t('planningQuestion')}
            <textarea
              className="mt-1 w-full rounded border p-2"
              maxLength={2000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!question.trim()}>
              {t('searchExperts')}
            </Button>
            {basis.stage === 'expert' && basis.question === question.trim() && (
              <Button
                type="button"
                variant="outline"
                onClick={() => search({ stage: 'composition', question: basis.question })}
              >
                {t('searchComponents')}
              </Button>
            )}
            {basis.stage !== 'directory' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setQuestion('')
                  search({ stage: 'directory' })
                }}
              >
                {t('allPlanningMethods')}
              </Button>
            )}
          </div>
        </form>
      )}
      <p className="text-muted-foreground text-sm">
        {basis.stage === 'directory'
          ? t('planningScope')
          : t('planningRank', { question: basis.question })}
      </p>
      {query.isError ? (
        <RequestFailure error={query.error} retry={() => void query.refetch()} />
      ) : !query.data ? (
        <p>{t('loading')}</p>
      ) : (
        <>
          {query.data.items.map((m) => (
            <article className={panel} key={m.method_id + ':' + m.latest_version}>
              <h3>
                {m.title} · v{m.latest_version}
              </h3>
              <p>
                {t('methodKind.' + m.method_kind)} · {m.summary}
              </p>
              {forQuestion === undefined && m.method_kind === 'expert' && (
                <Link
                  className="underline"
                  href={
                    routes.home(locale) +
                    '?' +
                    new URLSearchParams({
                      mode: 'expert',
                      formalReference: JSON.stringify({
                        method_id: m.method_id,
                        version: m.latest_version,
                        digest: m.digest,
                      }),
                    }) + (basis.stage === 'directory' ? '' : '#' + new URLSearchParams({ question: basis.question }))
                  }
                >
                  {t('askVersion')}
                </Link>
              )}
              {onPick && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    onPick({
                      title: m.title,
                      reference: {
                        method_id: m.method_id,
                        version: m.latest_version,
                        digest: m.digest,
                      },
                    })
                  }
                >
                  {t('chooseVersion')}
                </Button>
              )}
              <CandidateDeclaration
                reference={{ method_id: m.method_id, version: m.latest_version, digest: m.digest }}
              />
              <details>
                <summary>{t('identity')}</summary>
                <code className="break-all">
                  {m.method_id} · {m.digest}
                </code>
              </details>
            </article>
          ))}
          {!query.data.items.length && <p>{t('empty')}</p>}
          <div className="flex gap-2">
            {offset > 0 && (
              <Button variant="outline" onClick={() => setPages((prev) => prev.slice(0, -1))}>
                {t('previousPage')}
              </Button>
            )}
            {query.data.next !== null && (
              <Button
                variant="outline"
                onClick={() => setPages((prev) => [...prev, query.data.next!])}
              >
                {t('nextPage')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
