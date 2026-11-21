'use client'

import Link from 'next/link'
import { RegistrySources } from './registry-sources'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { CrossAppLink } from '@/components/common/cross-app-link'
import { RequestFailure } from '@/components/common/request-failure'
import { Button } from '@/components/ui/button'
import { assetAction } from '@/lib/workbench/capabilities'
import { useWorkbench } from '@/lib/workbench/context'
import { routes } from '@/lib/workbench/routes'
import {
  registryInstallation,
  registryInventory,
  registryPlanningMethods,
  registryActivity,
  registryKey,
  type RegisteredMethod,
  type RegistryAsset,
} from '@/lib/workbench/registry'

const panel = 'space-y-3 rounded-xl border p-4'

function EntryList({ asset }: { asset: RegistryAsset }) {
  const t = useTranslations('registry')
  const query = useQuery({
    queryKey: [...registryKey, asset.asset_id, asset.revision],
    queryFn: () => registryInstallation(asset.asset_id),
  })
  if (query.isError)
    return <RequestFailure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <p>{t('loading')}</p>
  return (
    <ul className="space-y-1 text-sm">
      {query.data.entries.map((e) => (
        <li key={e.kind + e.entry}>
          <code className="break-all">{e.entry}</code> · {e.kind}
        </li>
      ))}
      {!query.data.entries.length && <li>{t('emptyEntries')}</li>}
    </ul>
  )
}

function Installation({ asset, methods }: { asset: RegistryAsset; methods: RegisteredMethod[] }) {
  const t = useTranslations('registry'),
    c = useTranslations('capabilities')
  const { csrfToken, locale } = useWorkbench()
  const client = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const action = useMutation({
    mutationFn: (revision: number) =>
      assetAction(
        asset.asset_id,
        revision,
        asset.status === 'active' ? 'disable' : 'enable',
        csrfToken,
      ),
    onSettled: async () => {
      setConfirm(false)
      await Promise.all(
        [registryKey, ['capability-catalog'], ['capability-selection']].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      )
    },
  })
  return (
    <article className={panel}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{asset.name}</h3>
        <span className="text-sm">{c(`state.${asset.status}`)}</span>
      </header>
      <p className="text-muted-foreground text-sm">
        {asset.account_label || t(asset.kind)} · {c('revision', { revision: asset.revision })}
      </p>
      {methods.length > 0 && (
        <div className="text-sm">
          <strong>{t('derived')}</strong>
          <ul>
            {methods.map((m) => (
              <li key={m.reference.method_id + m.reference.version}>
                {m.title} · v{m.reference.version}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        className="text-sm underline"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {t('entries')}
      </button>
      {expanded && <EntryList asset={asset} />}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          className="text-sm underline"
          href={
            routes.settings(locale, asset.kind === 'connection' ? 'connections' : 'skills') +
            '#installation-' +
            asset.asset_id
          }
        >
          {t('manage')}
        </Link>
        {(asset.status === 'active' || asset.status === 'disabled') && !confirm && (
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() =>
              asset.status === 'active' ? setConfirm(true) : action.mutate(asset.revision)
            }
          >
            {c(asset.status === 'active' ? 'disable' : 'enable')}
          </Button>
        )}
      </div>
      {confirm && (
        <div className="bg-muted rounded-md p-3 text-sm" role="group">
          <p>{t('impact', { count: methods.length, name: asset.name })}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={action.isPending}
              onClick={() => action.mutate(asset.revision)}
            >
              {c('disable')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() => setConfirm(false)}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
      {action.isError && (
        <RequestFailure
          error={action.error}
          retry={() => void client.invalidateQueries({ queryKey: registryKey })}
        />
      )}
    </article>
  )
}

function RecentActivity() {
  const t = useTranslations('registry'),
    { locale } = useWorkbench()
  const query = useQuery({ queryKey: [...registryKey, 'activity'], queryFn: registryActivity })
  if (query.isError)
    return <RequestFailure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <p>{t('loading')}</p>
  if (!query.data.length) return <p>{t('emptyActivity')}</p>
  return (
    <ol className="divide-y rounded-xl border px-4">
      {query.data.map((e) => (
        <li key={[e.session_id, e.kind, e.record_id].join('/')} className="space-y-1 py-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <strong>
              {t('event.' + e.kind)} · {t('path.' + e.path)} · {e.action}
            </strong>
            <time dateTime={e.at}>{new Date(e.at).toLocaleString(locale)}</time>
          </div>
          <div>{e.status}</div>
          <details>
            <summary className="cursor-pointer">{t('trace')}</summary>
            <p className="font-mono text-xs break-all">
              {t('session')} · {e.session_id}
              <br />
              ID · {e.record_id}
              {e.asset_id && (
                <span className="block">
                  {t('path.installed')} · {e.asset_id}
                </span>
              )}
              {e.source && (
                <span className="block">
                  {e.source.source_id} · v{e.source.version} · {e.source.digest}
                </span>
              )}
              {e.reference && (
                <span className="block">
                  {t('path.formal')} · {e.reference.method_id} · v{e.reference.version} ·{' '}
                  {e.reference.digest}
                </span>
              )}
            </p>
          </details>
        </li>
      ))}
    </ol>
  )
}

function PlanningMethods() {
  const t = useTranslations('registry')
  const [offset, setOffset] = useState(0)
  const query = useQuery({
    queryKey: [...registryKey, 'planning', offset],
    queryFn: () => registryPlanningMethods(offset),
  })
  if (query.isError)
    return <RequestFailure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <p>{t('loading')}</p>
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">{t('planningScope')}</p>
      {query.data.items.map((m) => (
        <article className={panel} key={m.method_id + ':' + m.latest_version}>
          <h3>
            {m.title} · v{m.latest_version}
          </h3>
          <p>
            {t('methodKind.' + m.method_kind)} · {m.summary}
          </p>
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
          <Button variant="outline" onClick={() => setOffset(Math.max(0, offset - 30))}>
            {t('previousPage')}
          </Button>
        )}
        {query.data.next !== null && (
          <Button variant="outline" onClick={() => setOffset(query.data.next!)}>
            {t('nextPage')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function RegistrySection() {
  const t = useTranslations('registry')
  const { locale } = useWorkbench()
  const [tab, setTab] = useState<
    'installed' | 'formal' | 'sources' | 'planning' | 'native' | 'activity'
  >('formal')
  const [term, setTerm] = useState('')
  const query = useQuery({ queryKey: registryKey, queryFn: registryInventory })
  const client = useQueryClient()
  const data = query.data
  const matches = (...parts: (string | null)[]) =>
    parts.join(' ').toLowerCase().includes(term.trim().toLowerCase())
  const methods = data?.formal.filter((m) =>
    matches(
      m.title,
      m.reference.method_id,
      m.source_entry,
      t('methodKind.' + m.method_kind),
      t('runnerRoute.' + m.runner_route),
    ),
  )
  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('lead')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void client.invalidateQueries({ queryKey: registryKey })}
        >
          {t('refresh')}
        </Button>
      </header>
      <div className="flex flex-wrap gap-2">
        {(['formal', 'planning', 'sources', 'installed', 'native', 'activity'] as const).map(
          (k) => (
            <Button
              key={k}
              size="sm"
              variant={tab === k ? 'default' : 'outline'}
              aria-pressed={tab === k}
              onClick={() => {
                setTab(k)
                setTerm('')
              }}
            >
              {t(k)}
            </Button>
          ),
        )}
      </div>
      {(tab === 'installed' || tab === 'formal') && (
        <input
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          className="bg-background w-full rounded-lg border px-3 py-2 text-sm"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      )}
      {tab === 'planning' ? (
        <PlanningMethods />
      ) : tab === 'sources' ? (
        <RegistrySources />
      ) : query.isError ? (
        <RequestFailure error={query.error} retry={() => void query.refetch()} />
      ) : !data ? (
        <p>{t('loading')}</p>
      ) : (
        <>
          {tab === 'installed' && (
            <>
              <div className="flex gap-4 text-sm underline">
                <Link href={routes.settings(locale, 'connections')}>{t('connections')}</Link>
                <Link href={routes.settings(locale, 'skills')}>{t('skills')}</Link>
              </div>
              {data.installed
                .filter((a) => matches(a.name, a.account_label, a.asset_id))
                .map((a) => (
                  <Installation
                    key={a.asset_id + ':' + a.revision}
                    asset={a}
                    methods={data.formal.filter((m) => m.source_asset_id === a.asset_id)}
                  />
                ))}
              {!data.installed.some((a) => matches(a.name, a.account_label, a.asset_id)) && (
                <p>{t('empty')}</p>
              )}
            </>
          )}
          {tab === 'formal' && (
            <>
              <div className="flex gap-4 text-sm underline">
                <CrossAppLink to="knowlab.incubation">{t('lab')}</CrossAppLink>
                <CrossAppLink to="knowmart.shop">{t('shop')}</CrossAppLink>
              </div>
              <p className="text-muted-foreground text-sm">{t('qualification')}</p>
              {methods?.map((m) => {
                const asset = data.installed.find((a) => a.asset_id === m.source_asset_id)
                return (
                  <article
                    className={panel}
                    key={m.reference.method_id + ':' + m.reference.version}
                  >
                    <h3 className="font-semibold">
                      {m.title} · v{m.reference.version}
                    </h3>
                    <p className="text-sm">
                      {t('methodKind.' + m.method_kind)} · {t('runnerRoute.' + m.runner_route)}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {t('declaredCallers', {
                        callers: m.allowed_callers.map((c) => t('caller.' + c)).join(' / '),
                      })}
                    </p>
                    {m.source_kind && (
                      <p className="text-sm">
                        {t('source')} · {asset?.name || m.source_kind} · {m.source_entry}{' '}
                        {m.source_revision !== null && t('revision', { n: m.source_revision })}
                      </p>
                    )}
                    {asset &&
                      (asset.status !== 'active' || asset.revision !== m.source_revision) && (
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                          {t('sourceChanged')}
                        </p>
                      )}
                    <details>
                      <summary className="cursor-pointer text-sm">{t('identity')}</summary>
                      <dl className="mt-2 space-y-1 font-mono text-xs break-all">
                        <dt>ID</dt>
                        <dd>{m.reference.method_id}</dd>
                        <dt>{t('digest')}</dt>
                        <dd>{m.reference.digest}</dd>
                        {m.source_digest && (
                          <>
                            <dt>{t('sourceDigest')}</dt>
                            <dd>{m.source_digest}</dd>
                          </>
                        )}
                      </dl>
                    </details>
                    {m.dependencies.length > 0 && (
                      <div className="text-sm">
                        <strong>{t('dependencies')}</strong>
                        <ul>
                          {m.dependencies.map((r) => (
                            <li className="break-all" key={r.method_id + r.version}>
                              {data.formal.find(
                                (f) =>
                                  f.reference.method_id === r.method_id &&
                                  f.reference.version === r.version &&
                                  f.reference.digest === r.digest,
                              )?.title || r.method_id}{' '}
                              · v{r.version} · {r.digest}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                )
              })}
              {!methods?.length && <p>{t('empty')}</p>}
            </>
          )}
          {tab === 'activity' && <RecentActivity />}
          {tab === 'native' && (
            <>
              {data.native.map((a) => (
                <article className={panel} key={a.name}>
                  <h3 className="font-semibold">
                    {t.has('actions.' + a.name) ? t('actions.' + a.name) : a.name}
                  </h3>
                  {a.request && (
                    <p className="text-sm break-all">
                      {t(a.interaction === 'question' ? 'question' : 'approval')} ·{' '}
                      <code>{a.request}</code>
                    </p>
                  )}
                  {a.item_type && (
                    <p className="text-sm">
                      {t('observe')} · <code>{a.item_type}</code>
                    </p>
                  )}
                </article>
              ))}
            </>
          )}
        </>
      )}
    </section>
  )
}
