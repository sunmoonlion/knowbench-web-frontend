'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RequestFailure } from '@/components/common/request-failure'
import { useWorkbench } from '@/lib/workbench/context'
import { routes } from '@/lib/workbench/routes'
import * as api from '@/lib/workbench/capabilities'

const input = 'mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm'
const card = 'rounded-xl border p-5 space-y-3'
const queryKey = ['capability-catalog']

export function CapabilitySettings({ kind }: { kind: 'connection' | 'skill' }) {
  const t = useTranslations('capabilities')
  const { csrfToken, locale } = useWorkbench()
  const params = useSearchParams()
  const target = params.get('returnTo') ?? ''
  const returnTo =
    /^\/(zh-CN|en)\/workbench\/(chat\/[a-zA-Z0-9-]+|projects\/[a-zA-Z0-9-]+\/c\/[a-zA-Z0-9-]+)$/.test(
      target,
    )
      ? target
      : null
  const query = useQuery({ queryKey, queryFn: api.catalog })
  const client = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [renewing, setRenewing] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<api.Asset | null>(null)
  const action = useMutation({
    mutationFn: ({ asset, action }: { asset: api.Asset; action: string }) =>
      api.assetAction(asset.id, asset.revision, action, csrfToken),
    onSuccess: async () => {
      setDisconnecting(null)
      await client.invalidateQueries({ queryKey })
      await client.invalidateQueries({ queryKey: ['capability-selection'] })
    },
  })
  if (query.isError)
    return <RequestFailure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <p>{t('loading')}</p>
  const assets = query.data.assets.filter((a) => a.kind === kind)
  return (
    <div className="space-y-5">
      {returnTo ? (
        <Link className="text-sm underline" href={returnTo}>
          {t('returnToConversation')}
        </Link>
      ) : null}
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {t(kind === 'connection' ? 'connections' : 'skills')}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {t(kind === 'connection' ? 'connectionsLead' : 'skillsLead')}
          </p>
        </div>
        <Button onClick={() => setCreating(!creating)}>{t(creating ? 'close' : 'add')}</Button>
      </header>
      {kind === 'connection' && !query.data.runtime_enabled ? (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {t('runtimeUnavailable')}
        </p>
      ) : null}
      {creating ? (
        kind === 'connection' ? (
          <ConnectionForm services={query.data.services} done={() => setCreating(false)} />
        ) : (
          <SkillForm assets={query.data.assets} done={() => setCreating(false)} />
        )
      ) : null}
      {action.isError ? (
        <RequestFailure error={action.error} retry={() => void query.refetch()} />
      ) : null}
      {!assets.length ? <p className={card}>{t('empty')}</p> : null}
      {assets.map((asset) => (
        <section key={asset.id} className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{asset.name}</h3>
            <span className="bg-muted rounded-full px-2 py-1 text-xs">
              {t.has(`state.${asset.status}`) ? t(`state.${asset.status}`) : asset.status}
            </span>
          </div>
          <p className="text-muted-foreground text-sm break-all">
            {kind === 'connection'
              ? `${asset.detail.account_label} · ${asset.detail.url}`
              : `${asset.detail.version} · ${asset.detail.description}`}
          </p>
          <p className="text-muted-foreground text-xs">
            {t('revision', { revision: asset.revision })}
            {asset.detail.checked_at ? ` · ${t('checked')} ${asset.detail.checked_at}` : ''}
          </p>
          {asset.detail.revocation ? <p className="text-sm">{t('revokeAtProvider')}</p> : null}
          {kind === 'connection' ? (
            <details>
              <summary className="cursor-pointer text-sm">
                {t('toolsCount', { count: asset.detail.tools?.length ?? 0 })}
              </summary>
              <ul className="mt-3 space-y-3">
                {asset.detail.tools?.map((tool) => (
                  <li key={tool.name}>
                    <strong className="text-sm">{tool.name}</strong>
                    <p className="text-muted-foreground text-sm">{tool.description}</p>
                    <details>
                      <summary className="text-xs">{t('parameters')}</summary>
                      <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <>
              <p className="text-sm">
                {t('dependenciesCount', { count: asset.detail.dependencies?.length ?? 0 })}
              </p>
              {asset.detail.files?.length ? (
                <details>
                  <summary className="cursor-pointer text-sm">
                    {t('packageFiles', { count: asset.detail.files.length })}
                  </summary>
                  <ul className="mt-2 max-h-48 overflow-auto text-xs break-all">
                    {asset.detail.files.map((file) => (
                      <li key={file.path}>
                        {file.path} · {file.size} B
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <details>
                <summary className="cursor-pointer text-sm">{t('instructions')}</summary>
                <pre className="mt-2 max-h-72 overflow-auto text-sm whitespace-pre-wrap">
                  {asset.detail.content}
                </pre>
              </details>
              <Link className="text-sm underline" href={routes.settings(locale, 'connections')}>
                {t('manageDependencies')}
              </Link>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending || asset.status === 'disconnected'}
              onClick={() =>
                action.mutate({ asset, action: asset.status === 'active' ? 'disable' : 'enable' })
              }
            >
              {t(asset.status === 'active' ? 'disable' : 'enable')}
            </Button>
            {kind === 'connection' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending || asset.status !== 'active'}
                onClick={() =>
                  action.mutate({
                    asset,
                    action: asset.default_selected ? 'default_off' : 'default_on',
                  })
                }
              >
                {t(asset.default_selected ? 'removeDefault' : 'makeDefault')}
              </Button>
            ) : null}
            {kind === 'connection' ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending || asset.status !== 'active'}
                  onClick={() => action.mutate({ asset, action: 'refresh' })}
                >
                  {t('refreshTools')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending || asset.status === 'disconnected'}
                  onClick={() => setDisconnecting(asset)}
                >
                  {t('disconnect')}
                </Button>
              </>
            ) : null}
          </div>
          {kind === 'connection' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRenewing(renewing === asset.id ? null : asset.id)}
            >
              {t('renew')}
            </Button>
          ) : null}
          {renewing === asset.id ? (
            <RenewForm asset={asset} done={() => setRenewing(null)} />
          ) : null}
          {disconnecting?.id === asset.id ? (
            <div role="alert" className="rounded-lg border p-3">
              <p className="mb-3 text-sm">{t('disconnectWarning')}</p>
              <Button
                disabled={action.isPending}
                onClick={() => action.mutate({ asset, action: 'disconnect' })}
              >
                {t('confirmDisconnect')}
              </Button>{' '}
              <Button variant="outline" onClick={() => setDisconnecting(null)}>
                {t('cancel')}
              </Button>
            </div>
          ) : null}
        </section>
      ))}
      <p className="text-muted-foreground text-sm">{t('defaultHint')}</p>
    </div>
  )
}

function ConnectionForm({ services, done }: { services: { url: string }[]; done: () => void }) {
  const t = useTranslations('capabilities'),
    { csrfToken } = useWorkbench(),
    client = useQueryClient()
  const [name, setName] = useState(''),
    [account, setAccount] = useState(''),
    [url, setUrl] = useState(services[0]?.url ?? ''),
    [token, setToken] = useState('')
  const [requestId] = useState(() => crypto.randomUUID())
  const save = useMutation({
    mutationFn: () =>
      api.createConnection(
        { request_id: requestId, name, account_label: account, url, ...(token ? { token } : {}) },
        csrfToken,
      ),
    onSuccess: async () => {
      setToken('')
      await client.invalidateQueries({ queryKey })
      done()
    },
  })
  return (
    <form
      className={card}
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <h3 className="font-medium">{t('addConnection')}</h3>
      <label className="block text-sm">
        {t('name')}
        <input
          className={input}
          value={name}
          maxLength={100}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        {t('account')}
        <input
          className={input}
          value={account}
          maxLength={100}
          required
          onChange={(e) => setAccount(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        {t('service')}
        <select className={input} value={url} required onChange={(e) => setUrl(e.target.value)}>
          {services.map((s) => (
            <option key={s.url} value={s.url}>
              {s.url}
            </option>
          ))}
        </select>
      </label>
      {!services.length ? (
        <p role="status" className="text-sm">
          {t('noServices')}
        </p>
      ) : null}
      <label className="block text-sm">
        {t('token')}
        <input
          type="password"
          autoComplete="off"
          className={input}
          value={token}
          maxLength={4096}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <p className="text-muted-foreground text-sm">{t('connectionHint')}</p>
      {save.isError ? <RequestFailure error={save.error} retry={() => save.mutate()} /> : null}
      <Button type="submit" disabled={save.isPending || !url}>
        {t(save.isPending ? 'checking' : 'connect')}
      </Button>
    </form>
  )
}

function SkillForm({ done, assets }: { done: () => void; assets: api.Asset[] }) {
  const t = useTranslations('capabilities'),
    { csrfToken } = useWorkbench(),
    client = useQueryClient()
  const [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [version, setVersion] = useState('1'),
    [content, setContent] = useState(''),
    [error, setError] = useState('')
  const [dependencies, setDependencies] = useState<string[]>([])
  const [archive, setArchive] = useState('')
  const [filename, setFilename] = useState('')
  const [reading, setReading] = useState(false)
  const [requestId] = useState(() => crypto.randomUUID())
  const save = useMutation({
    mutationFn: () =>
      archive
        ? api.createSkillPackage(
            {
              request_id: requestId,
              name,
              description,
              version,
              archive_base64: archive,
              dependencies,
            },
            csrfToken,
          )
        : api.createSkill(
            { request_id: requestId, name, description, version, content, dependencies },
            csrfToken,
          ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey })
      done()
    },
  })
  return (
    <form
      className={card}
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <h3 className="font-medium">{t('addSkill')}</h3>
      <label className="block text-sm">
        {t('skillName')}
        <input
          className={input}
          required
          pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*"
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        {t('description')}
        <input
          className={input}
          required
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        {t('version')}
        <input
          className={input}
          required
          maxLength={50}
          value={version}
          onChange={(e) => setVersion(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        {t('importFile')}
        <input
          type="file"
          accept=".md,.zip,text/markdown,application/zip"
          disabled={reading || save.isPending}
          className={input}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setReading(true)
            setArchive('')
            setContent('')
            setFilename('')
            try {
              const upload = await api.readSkillUpload(file)
              setContent(upload.content)
              setArchive(upload.archive)
              setFilename(file.name)
              setError('')
            } catch {
              setError(t('fileError'))
            } finally {
              setReading(false)
            }
          }}
        />
      </label>
      {archive ? (
        <p role="status" className="text-sm">
          {t('packageReady', { filename })}
        </p>
      ) : (
        <label className="block text-sm">
          {t('instructions')}
          <textarea
            className={input}
            rows={10}
            required
            value={content}
            maxLength={64000}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
      )}
      <fieldset className="space-y-2">
        <legend>{t('manageDependencies')}</legend>
        {assets
          .filter((a) => a.kind === 'connection' && a.status === 'active')
          .flatMap((a) =>
            (a.detail.tools ?? [])
              .filter((t) => t.key)
              .map((tool) => (
                <label key={tool.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={dependencies.includes(tool.key!)}
                    onChange={(e) =>
                      setDependencies(
                        e.target.checked
                          ? [...dependencies, tool.key!]
                          : dependencies.filter((k) => k !== tool.key),
                      )
                    }
                  />
                  {a.name} · {a.detail.account_label} · {tool.name}
                </label>
              )),
          )}
      </fieldset>
      <p className="text-muted-foreground text-sm">{t('skillHint')}</p>
      {error ? <p role="alert">{error}</p> : null}
      {save.isError ? <RequestFailure error={save.error} retry={() => save.mutate()} /> : null}
      <Button
        type="submit"
        disabled={save.isPending || reading || (!archive && !content.trim()) || !!error}
      >
        {t(save.isPending ? 'saving' : 'import')}
      </Button>
    </form>
  )
}

function RenewForm({ asset, done }: { asset: api.Asset; done: () => void }) {
  const t = useTranslations('capabilities'),
    { csrfToken } = useWorkbench(),
    client = useQueryClient()
  const [token, setToken] = useState('')
  const save = useMutation({
    mutationFn: () => api.renewConnection(asset.id, asset.revision, token, csrfToken),
    onSuccess: async () => {
      setToken('')
      await client.invalidateQueries({ queryKey })
      await client.invalidateQueries({ queryKey: ['capability-selection'] })
      done()
    },
  })
  return (
    <form
      className="space-y-3 rounded border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <p>{t('renewHint')}</p>
      <label>
        {t('token')}
        <input
          type="password"
          autoComplete="off"
          maxLength={4096}
          className={input}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      {save.isError ? <RequestFailure error={save.error} retry={() => save.mutate()} /> : null}
      <Button type="submit" disabled={save.isPending}>
        {t(save.isPending ? 'checking' : 'connect')}
      </Button>
    </form>
  )
}
