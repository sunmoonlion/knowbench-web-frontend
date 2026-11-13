'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RequestFailure } from '@/components/common/request-failure'
import { useWorkbench } from '@/lib/workbench/context'
import * as api from '@/lib/workbench/capabilities'

const input = 'mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm'

export function toolRequirements(assets: api.Asset[], keys: string[]): api.ToolRequirement[] {
  const unique = new Map<string, api.ToolRequirement>()
  for (const asset of assets) {
    if (asset.kind !== 'connection' || !asset.detail.url) continue
    for (const tool of asset.detail.tools ?? []) {
      if (!tool.key || !keys.includes(tool.key)) continue
      const requirement = { url: asset.detail.url, name: tool.name }
      unique.set(JSON.stringify(requirement), requirement)
    }
  }
  return [...unique.values()]
}

export function SkillDependencies({
  assets,
  value,
  onChange,
  disabled = false,
}: {
  assets: api.Asset[]
  value: string[]
  onChange: (keys: string[]) => void
  disabled?: boolean
}) {
  const t = useTranslations('capabilities')
  const seen = new Set<string>()
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend>{t('manageDependencies')}</legend>
      <p className="text-muted-foreground text-sm">{t('dependencyDeclarationHint')}</p>
      {assets
        .filter((a) => a.kind === 'connection' && a.status === 'active')
        .flatMap((a) =>
          (a.detail.tools ?? [])
            .filter((tool) => {
              const identity = JSON.stringify([a.detail.url, tool.name])
              if (!tool.key || seen.has(identity)) return false
              seen.add(identity)
              return true
            })
            .map((tool) => (
              <label key={tool.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value.includes(tool.key!)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...value, tool.key!]
                        : value.filter((key) => key !== tool.key),
                    )
                  }
                />
                <span className="break-all">
                  {a.name} · {tool.name}
                  <small className="text-muted-foreground block">{a.detail.url}</small>
                </span>
              </label>
            )),
        )}
    </fieldset>
  )
}

export function SkillSourceInstaller({
  assets,
  done,
  scriptsEnabled = false,
}: {
  assets: api.Asset[]
  done: () => void
  scriptsEnabled?: boolean
}) {
  const t = useTranslations('capabilities'),
    { csrfToken } = useWorkbench(),
    client = useQueryClient()
  const [url, setUrl] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [dependencies, setDependencies] = useState<string[]>([])
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const preview = useMutation({
    mutationFn: () => api.previewSkillSource(url.trim(), csrfToken),
    onSuccess: (data) => {
      setSelected(data.candidates.length === 1 ? data.candidates[0].path : null)
      setRequestId(crypto.randomUUID())
    },
  })
  const candidate = preview.data?.candidates.find((c) => c.path === selected)
  const install = useMutation({
    mutationFn: () => {
      if (!candidate || !preview.data) throw new Error('Select a Skill first')
      return api.installSkillSource(
        {
          request_id: requestId,
          url: url.trim(),
          commit: preview.data.commit,
          path: candidate.path,
          digest: candidate.digest,
          tool_requirements: toolRequirements(assets, dependencies),
        },
        csrfToken,
      )
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['capability-catalog'] })
      done()
    },
  })
  return (
    <div className="space-y-4 rounded-xl border p-5">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          install.reset()
          setSelected(null)
          preview.mutate()
        }}
        className="space-y-3"
      >
        <label className="block text-sm">
          {t('repositoryUrl')}
          <input
            type="url"
            className={input}
            required
            value={url}
            disabled={preview.isPending || install.isPending}
            placeholder="https://github.com/owner/repository"
            onChange={(event) => {
              setUrl(event.target.value)
              preview.reset()
              install.reset()
              setSelected(null)
            }}
          />
        </label>
        <p className="text-muted-foreground text-sm">{t('repositoryHint')}</p>
        <Button type="submit" disabled={preview.isPending || install.isPending}>
          {t(preview.isPending ? 'checking' : 'previewSource')}
        </Button>
      </form>
      {preview.isError ? (
        <RequestFailure error={preview.error} retry={() => preview.mutate()} />
      ) : null}
      {preview.data ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs break-all">
            {preview.data.repository} · {preview.data.commit.slice(0, 12)}
          </p>
          {!preview.data.candidates.length ? <p role="status">{t('noSkillsFound')}</p> : null}
          <fieldset className="space-y-2" disabled={install.isPending}>
            <legend className="font-medium">{t('chooseSkill')}</legend>
            {preview.data.candidates.map((skill) => (
              <label key={skill.path} className="flex items-start gap-2 rounded-lg border p-3">
                <input
                  type="radio"
                  name="repository-skill"
                  checked={selected === skill.path}
                  onChange={() => {
                    setSelected(skill.path)
                    setDependencies([])
                    setRequestId(crypto.randomUUID())
                    install.reset()
                  }}
                />
                <span>
                  {skill.name}
                  <span className="text-muted-foreground block text-sm">{skill.description}</span>
                  <small>
                    {skill.path || '/'} · {t('packageFiles', { count: skill.files })}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          {candidate ? (
            <>
              <details>
                <summary className="cursor-pointer">{t('previewInstructions')}</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded border p-3 text-sm whitespace-pre-wrap">
                  {candidate.instructions}
                </pre>
              </details>
              <p className="text-muted-foreground text-sm">{t('installCompatibility')}</p>
              {candidate.has_scripts ? (
                <p role="status" className="rounded-lg border p-3 text-sm">
                  {t(scriptsEnabled ? 'scriptsSupported' : 'scriptsNotSupported')}
                </p>
              ) : null}
              <SkillDependencies
                assets={assets}
                value={dependencies}
                onChange={setDependencies}
                disabled={install.isPending}
              />
              {install.isError ? (
                <RequestFailure error={install.error} retry={() => install.mutate()} />
              ) : null}
              <Button disabled={install.isPending} onClick={() => install.mutate()}>
                {t(install.isPending ? 'installing' : 'installEnable')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
