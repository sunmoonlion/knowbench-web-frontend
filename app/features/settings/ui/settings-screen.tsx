'use client'

// 设置分三项（0021；会合点备忘第七节 2026-10-23 改）：个人偏好 / 模型 / 电脑与沙箱。左边一列三项，右边一次只显示一项。
// 「模型」的路由名仍是 cloud；沙箱从「模型」挪到「电脑与沙箱」。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

import type { Prefs } from '@/contracts/workbench-settings'
import { useWorkbench } from '@/lib/workbench/context'
import { routes, SETTINGS_SECTIONS, type SettingsSection } from '@/lib/workbench/routes'
import { cn } from '@/lib/utils'

import {
  addCredential,
  fetchPrefs,
  listCredentials,
  revokeCredential,
  savePrefs,
} from '../api/client'
import { AgentSetup } from './agent-setup'
import { LinkStatus } from './link-status'
import { LocalAgentSettings } from './local-agent-settings'
import { MachinesScreen } from './machines-screen'
import { PreferencesSection } from './preferences-section'

const POLICIES: Prefs['approval_policy'][] = ['untrusted', 'on-request', 'on-failure', 'never']
const input = 'bg-background mt-1 w-full rounded-lg border px-3 py-2 font-normal'
const primaryButton =
  'bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50'

export function SettingsScreen({ section }: { section: SettingsSection }) {
  const t = useTranslations('settings')
  const { csrfToken, locale } = useWorkbench()
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl gap-8 px-6 py-10">
        <nav aria-label={t('title')} className="w-44 shrink-0">
          <h1 className="px-2 text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <ul className="mt-4 space-y-1">
            {SETTINGS_SECTIONS.map((each) => (
              <li key={each}>
                <Link
                  href={routes.settings(locale, each)}
                  aria-current={each === section ? 'page' : undefined}
                  className={cn(
                    'hover:bg-foreground/5 block rounded-md px-2 py-1.5 text-sm',
                    each === section && 'bg-foreground/[0.07] font-medium',
                  )}
                >
                  {t(`nav.${each}`)}
                  <span className="text-muted-foreground block text-xs font-normal">
                    {t(`navHint.${each}`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 space-y-6">
          {section === 'preferences' ? <PreferencesSection /> : null}
          {section === 'cloud' ? <CloudSection csrfToken={csrfToken} /> : null}
          {section === 'computer' ? <ComputerSection csrfToken={csrfToken} /> : null}
        </div>
      </div>
    </div>
  )
}

// ---------------- 模型 ----------------
function CloudSection({ csrfToken }: { csrfToken: string }) {
  const t = useTranslations('settings.cloud')
  const { locale } = useWorkbench()
  const prefs = useQuery({ queryKey: ['wb-prefs'], queryFn: () => fetchPrefs() })
  return (
    <>
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('lead')}</p>
      </header>
      <KeysSection csrfToken={csrfToken} />
      {prefs.data ? (
        <ThreadSection
          key={`${prefs.data.model ?? ''}|${prefs.data.approval_policy}`}
          csrfToken={csrfToken}
          initial={prefs.data}
        />
      ) : null}
      <section className="flex items-center justify-between rounded-xl border p-5">
        <div>
          <h3 className="text-base font-semibold">{t('memory')}</h3>
          <p className="text-muted-foreground mt-1 text-sm">{t('memoryHint')}</p>
        </div>
        <Link href={routes.memory(locale)} className="rounded-lg border px-3 py-1.5 text-sm">
          {t('memoryOpen')}
        </Link>
      </section>
    </>
  )
}

function ThreadSection({ csrfToken, initial }: { csrfToken: string; initial: Prefs }) {
  const t = useTranslations('workbench.settings')
  const queryClient = useQueryClient()
  const [model, setModel] = useState(initial.model ?? '')
  const [policy, setPolicy] = useState<Prefs['approval_policy']>(initial.approval_policy)
  const save = useMutation({
    mutationFn: () =>
      savePrefs({ model: model.trim() || null, approval_policy: policy }, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wb-prefs'] }),
  })
  return (
    <section className="rounded-xl border p-5" aria-labelledby="settings-thread">
      <h3 id="settings-thread" className="text-base font-semibold">
        {t('thread')}
      </h3>
      <p className="text-muted-foreground mt-1 text-sm">{t('threadHint')}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label className="block text-sm font-medium">
          {t('model')}
          <input
            className={input}
            value={model}
            placeholder="kimi-k3"
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          {t('approvalPolicy')}
          <select
            className={input}
            value={policy}
            onChange={(e) => setPolicy(e.target.value as Prefs['approval_policy'])}
          >
            {POLICIES.map((p) => (
              <option key={p} value={p}>
                {t(`policy.${p}` as 'policy.never')}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButton} disabled={save.isPending}>
          {t('save')}
        </button>
        {save.isSuccess ? (
          <span className="text-muted-foreground ml-3 text-xs">{t('saved')}</span>
        ) : null}
      </form>
    </section>
  )
}

function KeysSection({ csrfToken }: { csrfToken: string }) {
  const t = useTranslations('workbench.settings')
  const s = useTranslations('settings')
  const queryClient = useQueryClient()
  const creds = useQuery({ queryKey: ['wb-credentials'], queryFn: () => listCredentials() })
  const [provider, setProvider] = useState('kimi')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const add = useMutation({
    mutationFn: () =>
      addCredential(
        { provider: provider.trim(), api_key: apiKey, base_url: baseUrl.trim() || null },
        csrfToken,
      ),
    onSuccess: () => {
      setApiKey('')
      void queryClient.invalidateQueries({ queryKey: ['wb-credentials'] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeCredential(id, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wb-credentials'] }),
  })

  return (
    <section className="rounded-xl border p-5" aria-labelledby="settings-keys">
      <h3 id="settings-keys" className="text-base font-semibold">
        {t('keys')}
      </h3>
      <p className="text-muted-foreground mt-1 text-sm">{t('keysHint')}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (apiKey.length >= 8) add.mutate()
        }}
      >
        <label className="block text-sm font-medium">
          {t('provider')}
          <input className={input} value={provider} onChange={(e) => setProvider(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          {t('apiKey')}
          <input
            className={input}
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          {s('baseUrl')}
          <input
            className={input}
            type="url"
            inputMode="url"
            placeholder="https://"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <span className="text-muted-foreground block text-xs font-normal">
            {s('baseUrlHint')}
          </span>
        </label>
        <button
          type="submit"
          className={primaryButton}
          disabled={add.isPending || apiKey.length < 8}
        >
          {t('submitKey')}
        </button>
        {add.error ? (
          <p role="alert" className="text-destructive text-xs">
            {t('error', { code: (add.error as Error).message })}
          </p>
        ) : null}
      </form>
      <ul className="mt-4 divide-y text-sm">
        {(creds.data ?? []).map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between py-2"
            data-credential-status={c.status}
          >
            <span className="min-w-0 truncate">
              {c.provider} · ****{c.hint} · {c.status === 'active' ? t('active') : t('revoked')}
              {c.base_url ? (
                <span className="text-muted-foreground font-mono text-xs"> · {c.base_url}</span>
              ) : null}
            </span>
            {c.status === 'active' ? (
              <button
                type="button"
                className="rounded-lg border px-3 py-1 text-xs"
                onClick={() => revoke.mutate(c.id)}
                disabled={revoke.isPending}
              >
                {t('revoke')}
              </button>
            ) : null}
          </li>
        ))}
        {creds.data && creds.data.length === 0 ? (
          <li className="text-muted-foreground py-2">{t('noKeys')}</li>
        ) : null}
      </ul>
    </section>
  )
}

// ---------------- 电脑与沙箱（页面标题：电脑、link、沙箱与令牌）----------------
function ComputerSection({ csrfToken }: { csrfToken: string }) {
  return (
    <>
      <MachinesScreen embedded />
      <LinkStatus />
      <AgentSetup csrfToken={csrfToken} />
      <LocalAgentSettings />
    </>
  )
}
