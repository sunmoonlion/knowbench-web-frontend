'use client'

import { CheckIcon, CircleIcon } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { useWorkbench } from '@/lib/workbench/context'
import { WorkbenchError } from '@/lib/workbench/http'
import { useMachines } from '@/lib/workbench/queries'
import { cn } from '@/lib/utils'
import type { PairingLookup } from '@/contracts/workbench-settings'

import { approvePairing, denyPairing, lookupPairing, removeMachine } from '../api/computer'
import { isOnline, progress } from '../model/guide'
import { formatPairingCode, pairingCodeComplete } from '../model/onboarding'
import { AgentDownloadPanel, AgentZipFallback } from './agent-download'
import { ReconnectComputer } from './agent-setup'

export function MachinesScreen({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('machines')
  const { csrfToken } = useWorkbench()
  const machines = useMachines(5000)
  const done = progress(machines.isSuccess ? machines.data : undefined)
  const steps = [
    { key: 'install', target: 'agent-download' },
    { key: 'connect', target: 'agent-connect' },
    { key: 'folders', target: 'computer-status' },
  ] as const
  const body = (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10">
      <section id="computer" aria-label={t('title')} className="space-y-8">
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">{t('title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('lead')}</p>
        </header>
        <section aria-label={t('guide.title')} className="space-y-3">
          <h3 className="text-sm font-medium">{t('guide.title')}</h3>
          <p className="text-muted-foreground text-sm">{t('guide.evidence')}</p>
          <ol className="divide-y rounded-xl border">
            {steps.map((step, index) => (
              <li key={step.key} className="flex items-start gap-3 px-4 py-3 text-sm">
                {done[step.key] ? (
                  <CheckIcon
                    className="mt-0.5 size-4 shrink-0 text-green-700"
                    aria-label={t('guide.done')}
                  />
                ) : (
                  <CircleIcon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-label={t('guide.todo')}
                  />
                )}
                <a href={`#${step.target}`} className="underline underline-offset-3">
                  {index + 1}. {t(`guide.${step.key}`)}
                </a>
              </li>
            ))}
          </ol>
        </section>
        <MachineList />
        <AgentDownloadPanel csrfToken={csrfToken} />
        <ConnectComputer csrfToken={csrfToken} />
        <details id="agent-advanced" className="rounded-xl border p-5">
          <summary className="cursor-pointer text-base font-semibold">
            {t('advanced.title')}
          </summary>
          <div className="mt-3 space-y-4">
            <AgentZipFallback />
            <ReconnectComputer csrfToken={csrfToken} />
          </div>
        </details>
      </section>
    </div>
  )
  if (embedded) return body
  return <div className="h-full overflow-y-auto">{body}</div>
}

function ConnectComputer({ csrfToken }: { csrfToken: string }) {
  const { user } = useWorkbench()
  const t = useTranslations('machines.connect')
  const s = useTranslations('machines.setup')
  const params = useSearchParams()
  // 本机代理打开的地址带着码（0012 §4，2026-10-12）：自动填、自动核对，用户只看机器名点允许。
  const prefilled = formatPairingCode(params.get('code') ?? '')
  const [code, setCode] = useState(() => (pairingCodeComplete(prefilled) ? prefilled : ''))
  const [auto, setAuto] = useState(() => pairingCodeComplete(prefilled))
  const [found, setFound] = useState<PairingLookup | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fail = (error: unknown) => {
    setFound(null)
    setMessage(error instanceof WorkbenchError && error.status === 429 ? s('tooFast') : t('wrong'))
  }
  const lookup = useMutation({
    mutationFn: (value: string) => lookupPairing(csrfToken, value),
    onMutate: () => setMessage(null),
    onSuccess: (result) => setFound(result),
    onError: fail,
  })
  const lookupNow = lookup.mutate
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !pairingCodeComplete(prefilled)) return
    started.current = true
    lookupNow(prefilled)
    document.getElementById('agent-connect')?.scrollIntoView?.({ block: 'start' })
  }, [prefilled, lookupNow])
  // 决定之后把地址里的码去掉：刷新不再重复核对，历史里也不留着。
  const decided = () => {
    setFound(null)
    if (auto && typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}#computer`)
    }
    setAuto(false)
  }
  const approve = useMutation({
    mutationFn: () => approvePairing(csrfToken, found!.id, code),
    onSuccess: (result) => {
      decided()
      setMessage(t('approved', { name: result.machine_name ?? '' }))
    },
    onError: fail,
  })
  const deny = useMutation({
    mutationFn: () => denyPairing(csrfToken, found!.id),
    onSuccess: () => {
      decided()
      setMessage(t('denied'))
    },
    onError: fail,
  })
  return (
    <section id="agent-connect" className="space-y-3 rounded-xl border p-5" aria-label={t('title')}>
      <h3 className="text-base font-semibold">{t('title')}</h3>
      {auto && (found || lookup.isPending) ? (
        <p className="text-sm font-medium">{t('prefilled')}</p>
      ) : null}
      <label className="block text-sm">
        {t('code')}
        <input
          className="mt-1 w-full rounded border p-2 font-mono uppercase"
          value={code}
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={9}
          onChange={(event) => {
            setFound(null)
            setCode(formatPairingCode(event.target.value))
          }}
        />
      </label>
      <p className="text-muted-foreground text-sm">{t('hint')}</p>
      <button
        type="button"
        className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
        disabled={!pairingCodeComplete(code) || lookup.isPending}
        onClick={() => lookup.mutate(code)}
      >
        {t('lookup')}
      </button>
      {found ? (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p>{found.machine_name}</p>
          <p>{found.os}</p>
          <p>{found.agent_version}</p>
          <p>{found.source_ip ?? t('unknownSource')}</p>
          <p>{t('ago', { seconds: found.requested_seconds_ago })}</p>
          {found.replaces_machine ? (
            <p className="font-semibold">{t('replace', { name: found.replaces_machine })}</p>
          ) : null}
          {/* 连到哪个账号说出来：浏览器登着别的账号时点了允许，电脑就配进了那个账号（账 133） */}
          {user ? (
            <p className="font-semibold" title={user.email ?? undefined}>
              {t('intoAccount', { account: user.name })}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-sm"
              onClick={() => approve.mutate()}
            >
              {t('allow')}
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-sm"
              onClick={() => deny.mutate()}
            >
              {t('deny')}
            </button>
          </div>
        </div>
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
    </section>
  )
}

function MachineList() {
  const t = useTranslations('machines')
  const format = useFormatter()
  const machines = useMachines(5000)
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  const [removeFailed, setRemoveFailed] = useState<string | null>(null)
  // 账 179：没连着的电脑可以移除（账 175 合并后旧配对的记录也在列表里）
  const remove = useMutation({
    mutationFn: (id: string) => removeMachine(csrfToken, id),
    onMutate: () => setRemoveFailed(null),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['workbench'] }),
    onError: (_error, id) => setRemoveFailed(id),
  })
  const label = 'text-muted-foreground'
  return (
    // 一个账号同一时刻一台电脑（所有者 2026-10-12 定甲）：这一块就是那台电脑的全部，不另列清单
    <section id="computer-status" aria-label={t('current')} className="space-y-3">
      <h3 className="text-base font-semibold">{t('current')}</h3>
      <p className="text-muted-foreground text-sm">{t('guide.onlineHint')}</p>
      {machines.isPending ? (
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      ) : machines.isError ? (
        <div role="alert">
          <p>{t('loadFailed')}</p>
          <button type="button" className="underline" onClick={() => void machines.refetch()}>
            {t('setup.retryStatus')}
          </button>
        </div>
      ) : (machines.data ?? []).length === 0 ? (
        <p className="text-muted-foreground rounded-xl border px-4 py-3 text-sm">{t('none')}</p>
      ) : (
        (machines.data ?? []).map((machine) => {
          const online = isOnline(machine)
          const mode = machine.ceiling?.sandbox
          return (
            <article key={machine.id} className="space-y-3 rounded-xl border p-5">
              <header className="flex items-center gap-2">
                <span
                  className={cn('size-2 rounded-full', online ? 'bg-green-600' : 'bg-amber-500')}
                />
                <h3 className="text-base font-semibold">{machine.name}</h3>
                <span className={cn('text-sm', online ? label : 'text-amber-700')}>
                  {online ? t('online') : t('offline')}
                </span>
              </header>
              {online ? null : <p className="text-sm text-amber-700">{t('offlineNote')}</p>}
              {online ? null : (
                <p className="text-sm">
                  <button
                    type="button"
                    className="underline underline-offset-3 disabled:opacity-50"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(machine.id)}
                  >
                    {remove.isPending && remove.variables === machine.id
                      ? t('removing')
                      : t('remove')}
                  </button>
                  {removeFailed === machine.id ? (
                    <span className="ml-2 text-red-700">{t('removeFailed')}</span>
                  ) : null}
                </p>
              )}
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className={label}>{t('agent')}</dt>
                <dd>{machine.agent_version ?? t('unknown')}</dd>
                <dt className={label}>{t('codex')}</dt>
                <dd>{machine.codex_version ?? t('unknown')}</dd>
                <dt className={label}>{t('lastSeen')}</dt>
                <dd>
                  {machine.last_seen_at
                    ? format.dateTime(new Date(machine.last_seen_at), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : t('unknown')}
                </dd>
                <dt className={label}>{t('roots')}</dt>
                <dd>
                  {machine.roots.length === 0 ? (
                    <span className="text-amber-700">{t('noRoots')}</span>
                  ) : (
                    <ul className="font-mono text-[13px]">
                      {machine.roots.map((root) => (
                        <li key={root}>{root}</li>
                      ))}
                    </ul>
                  )}
                </dd>
                <dt className={label}>{t('ceiling.title')}</dt>
                <dd>
                  {mode && t.has(`ceiling.sandbox.${mode}`)
                    ? t(`ceiling.sandbox.${mode}`)
                    : (mode ?? t('unknown'))}
                  {'；'}
                  {machine.ceiling?.network ? t('ceiling.networkOn') : t('ceiling.networkOff')}
                </dd>
              </dl>
            </article>
          )
        })
      )}
      <p className="text-muted-foreground text-[13px]">{t('ceiling.note')}</p>
      {/* 账号跟着人走、代理跟着电脑走；网页看不出自己在哪台电脑上（所有者 2026-10-12 定甲） */}
      {(machines.data ?? []).length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('elsewhere', { name: machines.data![0].name })}
        </p>
      ) : null}
    </section>
  )
}
