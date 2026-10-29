'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ServiceProblem } from '@/components/workbench/file-tree'
import type { LocalSettings } from '@/contracts/workbench-v2'
import { localProblemCode, writeSettings, type SettingsChange } from '@/lib/workbench/local-agent'
import { useLocalAgent, useLocalSettings, useMachines } from '@/lib/workbench/queries'
import { cn } from '@/lib/utils'

import { isOnline } from '../model/guide'

// 「这台电脑上的设置」（0021 §二之 3，0022 乙案）：白名单目录、上限、自启存在电脑上的代理里。
// 在这里改是直接送到那台电脑（经回环口）；放宽的改动代理会在电脑上弹确认窗，用户点了才写，写完代理自己重启。
// 不在那台电脑上、代理没跑、接的是别的账号：只显示代理上次报来的，并说清为什么改不了。
type Draft = {
  roots: string[]
  rootChoices: string[]
  sandbox: string
  network: boolean
  autostart: boolean
}

function fromSettings(settings: LocalSettings): Draft {
  return {
    roots: settings.roots,
    rootChoices: settings.rootChoices ?? settings.roots,
    sandbox: settings.ceiling.sandbox,
    network: settings.ceiling.network,
    autostart: settings.autostart ?? false,
  }
}

// 只送改了的项；代理那头按「放宽 / 收窄」判要不要本机确认
export function changesBetween(base: Draft, next: Draft): SettingsChange {
  const change: SettingsChange = {}
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  if (!same(base.roots, next.roots)) change.roots = next.roots
  if (!same(base.rootChoices, next.rootChoices)) change.rootChoices = next.rootChoices
  if (base.sandbox !== next.sandbox || base.network !== next.network) {
    change.ceiling = { sandbox: next.sandbox, network: next.network }
  }
  if (base.autostart !== next.autostart) change.autostart = next.autostart
  return change
}

// 哪些改动是放宽的（代理会弹窗）：提前告诉用户要去电脑上点一下
export function widens(base: Draft, next: Draft): boolean {
  const lower = (s: string) => s.toLowerCase()
  if (next.roots.some((root) => !base.roots.map(lower).includes(lower(root)))) return true
  if (base.sandbox === 'read-only' && next.sandbox === 'workspace-write') return true
  if (!base.network && next.network) return true
  if (!base.autostart && next.autostart) return true
  return false
}

export function LocalAgentSettings() {
  const t = useTranslations('settings.computer')
  const machines = useMachines()
  const current = (machines.data ?? []).find(isOnline) ?? machines.data?.[0] ?? null
  const link = useLocalAgent(current?.id ?? null)
  const settings = useLocalSettings(link.data ?? null)
  return (
    <section className="rounded-xl border p-5" aria-labelledby="settings-local">
      <h3 id="settings-local" className="text-base font-semibold">
        {t('local')}
      </h3>
      <p className="text-muted-foreground mt-1 text-sm">{t('localLead')}</p>
      {machines.isSuccess && !current ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('none')}</p>
      ) : null}
      {current && link.isError ? (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex gap-1">
            <span className="shrink-0">{t('cannotEdit')}</span>
            <ServiceProblem error={link.error} />
          </div>
          <p className="text-muted-foreground">{t('readOnlyFrom')}</p>
          <ReportedByAgent
            roots={current.roots}
            sandbox={current.ceiling?.sandbox}
            network={current.ceiling?.network}
          />
        </div>
      ) : null}
      {current && link.data ? (
        settings.isError ? (
          <div className="mt-3 text-sm">
            <ServiceProblem error={settings.error} />
          </div>
        ) : settings.data ? (
          <SettingsForm
            key={settings.dataUpdatedAt}
            agent={link.data}
            settings={settings.data}
            onApplied={() => {
              // 代理写完会自己重启；几秒后重新探它、重新读
              setTimeout(() => {
                void link.refetch()
                void settings.refetch()
              }, 4000)
            }}
          />
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">{t('loading')}</p>
        )
      ) : null}
    </section>
  )
}

function ReportedByAgent({
  roots,
  sandbox,
  network,
}: {
  roots: string[]
  sandbox?: string
  network?: boolean
}) {
  const t = useTranslations('settings.computer')
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt className="text-muted-foreground">{t('roots')}</dt>
      <dd>
        {roots.length === 0 ? (
          <span className="text-muted-foreground">{t('noRoots')}</span>
        ) : (
          <ul className="font-mono text-xs">
            {roots.map((root) => (
              <li key={root}>{root}</li>
            ))}
          </ul>
        )}
      </dd>
      <dt className="text-muted-foreground">{t('sandboxMode')}</dt>
      <dd>{sandbox ?? t('unknown')}</dd>
      <dt className="text-muted-foreground">{t('network')}</dt>
      <dd>{network === undefined ? t('unknown') : network ? t('allowed') : t('blocked')}</dd>
    </dl>
  )
}

function SettingsForm({
  agent,
  settings,
  onApplied,
}: {
  agent: NonNullable<ReturnType<typeof useLocalAgent>['data']>
  settings: LocalSettings
  onApplied: () => void
}) {
  const t = useTranslations('settings.computer')
  const client = useQueryClient()
  const base = fromSettings(settings)
  const [draft, setDraftState] = useState<Draft>(base)
  const [newRoot, setNewRoot] = useState('')
  const [outcome, setOutcome] = useState<'saved' | null>(null)
  // 再改任何一项，「已保存」就撤掉
  const setDraft = (update: Draft | ((d: Draft) => Draft)) => {
    setOutcome(null)
    setDraftState(update)
  }
  const change = changesBetween(base, draft)
  const dirty = Object.keys(change).length > 0
  const save = useMutation({
    mutationFn: () => writeSettings(agent, change),
    onSuccess: () => {
      setOutcome('saved')
      void client.invalidateQueries({ queryKey: ['workbench', 'machines'] })
      onApplied()
    },
  })
  const failure = save.isError ? localProblemCode(save.error) : null
  const toggleRoot = (root: string) =>
    setDraft((d) => ({
      ...d,
      roots: d.roots.includes(root) ? d.roots.filter((r) => r !== root) : [...d.roots, root],
    }))
  const addRoot = () => {
    const path = newRoot.trim()
    if (!path || draft.rootChoices.includes(path)) return
    setDraft((d) => ({ ...d, rootChoices: [...d.rootChoices, path], roots: [...d.roots, path] }))
    setNewRoot('')
  }
  return (
    <form
      className="mt-3 space-y-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty && !save.isPending) save.mutate()
      }}
    >
      <fieldset>
        <legend className="font-medium">{t('roots')}</legend>
        {draft.rootChoices.length === 0 ? (
          <p className="text-muted-foreground">{t('noRoots')}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {draft.rootChoices.map((root) => (
              <li key={root}>
                <label className="flex items-center gap-2 font-mono text-xs">
                  <input
                    type="checkbox"
                    checked={draft.roots.includes(root)}
                    onChange={() => toggleRoot(root)}
                  />
                  {root}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex gap-2">
          <Input
            value={newRoot}
            onChange={(event) => setNewRoot(event.target.value)}
            placeholder={t('addRootPlaceholder')}
            aria-label={t('addRoot')}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRoot}
            disabled={!newRoot.trim()}
          >
            {t('addRoot')}
          </Button>
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="font-medium">{t('sandboxMode')}</span>
          <select
            value={draft.sandbox}
            onChange={(event) => setDraft((d) => ({ ...d, sandbox: event.target.value }))}
            className="bg-background mt-1 block w-full rounded-md border px-2 py-1.5"
          >
            <option value="read-only">{t('sandbox.read-only')}</option>
            <option value="workspace-write">{t('sandbox.workspace-write')}</option>
          </select>
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.network}
              onChange={(event) => setDraft((d) => ({ ...d, network: event.target.checked }))}
            />
            <span className="font-medium">{t('network')}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.autostart}
              onChange={(event) => setDraft((d) => ({ ...d, autostart: event.target.checked }))}
            />
            <span className="font-medium">{t('autostart')}</span>
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
          {save.isPending ? t('saving') : t('save')}
        </Button>
        {save.isPending && widens(base, draft) ? (
          <span role="status" className="text-amber-700">
            {t('confirmOnComputer')}
          </span>
        ) : null}
        {outcome === 'saved' ? (
          <span role="status" className="text-green-700">
            {t('saved')}
          </span>
        ) : null}
        {failure ? (
          <span role="alert" className={cn('text-destructive')}>
            {t.has(`failure.${failure}`) ? t(`failure.${failure}`) : t('failure.other')}
          </span>
        ) : null}
        {settings.lastSettingsChange ? (
          <span className="text-muted-foreground text-xs">
            {t('lastChange', { at: new Date(settings.lastSettingsChange).toLocaleString() })}
          </span>
        ) : null}
      </div>
    </form>
  )
}
