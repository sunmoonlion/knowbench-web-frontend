'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { WorkbenchError } from '@/lib/workbench/http'

import { fetchAgentDownload, issueInstallCommand } from '../api/computer'
import { minutesRemaining } from '../model/onboarding'

export function AgentDownloadPanel({ csrfToken }: { csrfToken: string }) {
  const t = useTranslations('machines.setup')
  const a = useTranslations('machines.advanced')
  const query = useQuery({
    queryKey: ['agent-download'],
    queryFn: () => fetchAgentDownload(),
    retry: false,
  })
  const release = query.data?.download
  const [copied, setCopied] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const issue = useMutation({
    mutationFn: async () => {
      if (!release) throw new Error('release unavailable')
      const result = await issueInstallCommand(csrfToken, release)
      try {
        await navigator.clipboard.writeText(result.command)
      } catch {
        throw new Error('clipboard_failed')
      }
      return result.expires_at
    },
    gcTime: 0,
    onMutate: () => {
      setCopied(null)
      setNotice(null)
    },
    onSuccess: setCopied,
    onError: (error) => {
      if (error instanceof WorkbenchError && error.status === 409) void query.refetch()
      setNotice(
        error.message === 'clipboard_failed'
          ? a('copyFailed')
          : error instanceof WorkbenchError && error.status === 429
            ? t('tooFast')
            : t('downloadFailed'),
      )
    },
  })
  return (
    <section
      id="agent-download"
      className="space-y-3 rounded-xl border p-5"
      aria-label={t('downloadTitle')}
    >
      <h2 className="text-base font-semibold">{t('downloadTitle')}</h2>
      {query.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : query.isError ? (
        <div>
          <p role="alert">{t('downloadFailed')}</p>
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            {t('retryStatus')}
          </button>
        </div>
      ) : !release ? (
        <p>{t('unavailable')}</p>
      ) : (
        <>
          <p>
            {t('packageInfo', {
              version: release.version,
              codex: release.codex_version,
              size: (release.size_bytes / 1048576).toFixed(2),
            })}
          </p>
          <button
            type="button"
            className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            disabled={issue.isPending}
            onClick={() => issue.mutate()}
          >
            {t('copyCommand')}
          </button>
          <p className="text-muted-foreground text-sm">{t('copyHint')}</p>
          {copied ? <InstallExpiry expires={copied} /> : null}
        </>
      )}
      {notice ? <p role="alert">{notice}</p> : null}
    </section>
  )
}

function InstallExpiry({ expires }: { expires: string }) {
  const t = useTranslations('machines.setup')
  const [now, setNow] = useState(Date.now)
  const minutes = minutesRemaining(expires, now)
  useEffect(() => {
    if (!minutes) return
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Date.parse(expires) - Date.now() - (minutes - 1) * 60000),
    )
    return () => clearTimeout(timer)
  }, [expires, minutes, now])
  return (
    <p role="status">
      {minutes ? (
        <>
          {t('copied')} {t('remaining', { minutes })}
        </>
      ) : (
        t('commandExpired')
      )}
    </p>
  )
}

export function AgentZipFallback() {
  const t = useTranslations('machines.setup')
  const a = useTranslations('machines.advanced')
  const query = useQuery({
    queryKey: ['agent-download'],
    queryFn: () => fetchAgentDownload(),
    retry: false,
  })
  const release = query.data?.download
  if (!query.isSuccess) return null
  if (!release) return <p>{t('unavailable')}</p>
  return (
    <div className="space-y-2">
      <a
        className="inline-block underline"
        href={release.url}
        download="windows-x64.zip"
        referrerPolicy="no-referrer"
      >
        {t('downloadButton')}
      </a>
      <dl className="text-xs break-all">
        <dt>ZIP SHA256</dt>
        <dd className="font-mono">{release.zip_sha256}</dd>
        <dt>{t('manifestSha')}</dt>
        <dd className="font-mono">{release.manifest_sha256}</dd>
      </dl>
      <p className="text-sm">{a('unlock')}</p>
    </div>
  )
}
