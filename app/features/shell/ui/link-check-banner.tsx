'use client'

// 工作台顶上的单独提示（会合点备忘第五节，账 143）：只在要用户做事时出现，一切正常不显示；侧栏不挂这类状态。
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { useWorkbench } from '@/lib/workbench/context'
import {
  useCredentials,
  useLocalLink,
  useLocalPresence,
  useSandboxStatus,
} from '@/lib/workbench/queries'
import { routes } from '@/lib/workbench/routes'

import { linkCheck, type LinkPrompt, type SandboxPrompt } from '../model/link-check'

const bar = 'flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm'
const action = 'underline underline-offset-3 hover:no-underline'

export function LinkCheckBanner() {
  const t = useTranslations('shell.linkCheck')
  const { locale } = useWorkbench()
  const presence = useLocalPresence()
  const local = useLocalLink()
  const sandbox = useSandboxStatus()
  const keys = useCredentials()
  const { link, sandbox: box } = linkCheck({
    presence: presence.isSuccess ? (presence.data?.presence ?? null) : undefined,
    assigned: local.isSuccess ? local.data.assigned : undefined,
    copied: local.isSuccess ? local.data.copied : undefined,
    sandboxReady: sandbox.isSuccess ? Boolean(sandbox.data.ready) : undefined,
    hasKey: keys.isSuccess ? keys.data.some((key) => key.status === 'active') : undefined,
  })
  if (link === null && box === null) return null
  const computer = routes.computer(locale)
  return (
    <div role="status" aria-label={t('label')}>
      {link ? <LinkLine prompt={link} computer={computer} /> : null}
      {box ? (
        <SandboxLine prompt={box} computer={computer} models={routes.settings(locale, 'cloud')} />
      ) : null}
    </div>
  )
}

function LinkLine({ prompt, computer }: { prompt: LinkPrompt; computer: string }) {
  const t = useTranslations('shell.linkCheck')
  if (prompt.kind === 'no_local_link')
    return (
      <p className="text-muted-foreground border-b px-4 py-1.5 text-xs">
        {prompt.name ? t('noLocalLinkNamed', { name: prompt.name }) : t('noLocalLink')}
      </p>
    )
  const text =
    prompt.kind === 'copied'
      ? t('copied', { first: prompt.first, host: prompt.host })
      : t(
          {
            token_invalid: 'tokenInvalid',
            unreachable: 'unreachable',
            version_mismatch: 'versionMismatch',
            not_this_computer: 'notThisComputer',
          }[prompt.kind],
        )
  const reissue = prompt.kind === 'token_invalid' || prompt.kind === 'not_this_computer'
  return (
    <p className={`${bar} bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100`}>
      <span>{text}</span>
      {reissue ? (
        <Link href={`${computer}#link-status`} className={action}>
          {t('reissue')}
        </Link>
      ) : prompt.kind === 'version_mismatch' || prompt.kind === 'copied' ? (
        <Link href={computer} className={action}>
          {t('toComputer')}
        </Link>
      ) : null}
    </p>
  )
}

function SandboxLine({
  prompt,
  computer,
  models,
}: {
  prompt: SandboxPrompt
  computer: string
  models: string
}) {
  const t = useTranslations('shell.linkCheck')
  return (
    <p className={`${bar} bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100`}>
      <span>{prompt.kind === 'no_key' ? t('noKey') : t('sandboxNotReady')}</span>
      <Link href={prompt.kind === 'no_key' ? models : computer} className={action}>
        {prompt.kind === 'no_key' ? t('toModels') : t('toComputer')}
      </Link>
    </p>
  )
}
