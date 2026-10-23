'use client'

// 「电脑与沙箱」里的现在的状态（会合点备忘第四、七节，账 143）：本地 link 连没连着、沙箱就绪没有、配对成功没有，
// 以及电脑名与系统、接入日期、最近一次联系、令牌到期日。页面里不出现「会合点」。
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'

import { useWorkbench } from '@/lib/workbench/context'
import { useCredentials, useLocalLink, useSandboxStatus } from '@/lib/workbench/queries'
import { routes } from '@/lib/workbench/routes'

const label = 'text-muted-foreground'

export function LinkStatus() {
  const t = useTranslations('settings.computer.status')
  const shell = useTranslations('shell.linkCheck')
  const format = useFormatter()
  const { locale } = useWorkbench()
  const local = useLocalLink()
  const sandbox = useSandboxStatus()
  const keys = useCredentials()
  const when = (value: string | null | undefined) =>
    value ? format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : '—'
  const assigned = local.data?.assigned ?? null
  const connected = assigned?.status === 'online'
  const ready = sandbox.isSuccess && Boolean(sandbox.data.ready)
  const needKey = keys.isSuccess && !keys.data.some((key) => key.status === 'active')
  const missing = [connected ? null : t('missingLink'), ready ? null : t('missingSandbox')].filter(
    (each): each is string => each !== null,
  )
  return (
    <section id="link-status" aria-label={t('title')} className="space-y-3 rounded-xl border p-5">
      <h3 className="text-base font-semibold">{t('title')}</h3>
      {local.isSuccess && assigned === null ? (
        <p className="text-muted-foreground text-sm">{t('none')}</p>
      ) : null}
      {assigned ? (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className={label}>{t('link')}</dt>
          <dd>{connected ? t('connected') : t('notConnected')}</dd>
          <dt className={label}>{t('computer')}</dt>
          <dd>{[assigned.name, assigned.os].filter(Boolean).join(' · ')}</dd>
          <dt className={label}>{t('joined')}</dt>
          <dd>{when(assigned.created_at)}</dd>
          <dt className={label}>{t('lastSeen')}</dt>
          <dd>{when(assigned.last_seen_at)}</dd>
          <dt className={label}>{t('tokenExpires')}</dt>
          <dd>{when(local.data?.token_expires_at)}</dd>
        </dl>
      ) : null}
      {local.data?.copied && assigned?.first_host && assigned.host ? (
        <p className="text-sm text-amber-700">
          {shell('copied', { first: assigned.first_host, host: assigned.host })}
        </p>
      ) : null}
      <p className="text-muted-foreground text-sm">{t('reissueHint')}</p>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className={label}>{t('sandbox')}</dt>
        <dd>{ready ? t('ready') : t('notReady')}</dd>
      </dl>
      {needKey ? (
        <p className="text-sm">
          {t('needKey')}{' '}
          <Link href={routes.settings(locale, 'cloud')} className="underline underline-offset-3">
            {t('toModels')}
          </Link>
        </p>
      ) : null}
      {local.isSuccess && sandbox.isSuccess ? (
        <p className="text-sm font-medium">
          {missing.length === 0 ? t('paired') : t('unpaired', { missing: missing.join(t('and')) })}
        </p>
      ) : null}
    </section>
  )
}
