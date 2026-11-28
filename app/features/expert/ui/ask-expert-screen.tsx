'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { ConnectComputerLink } from '@/components/workbench/connect-computer'
import { useWorkbench } from '@/lib/workbench/context'
import { useMachines, useProjectDetail, useSandboxes } from '@/lib/workbench/queries'
import { routes } from '@/lib/workbench/routes'
import { cn } from '@/lib/utils'
import { useSaid } from '../api/desk'
import { findBlocker } from '../model/ask'
import { FormalExpertIntake } from './formal-expert-intake'

const noSubscription = () => () => {}
const label = 'text-muted-foreground mb-1.5 text-xs font-medium'
export function AskExpertScreen({
  project: projectId,
  from,
}: {
  project: string
  from: string | null
}) {
  const t = useTranslations('askExpert')
  const { locale } = useWorkbench()
  const project = useProjectDetail(projectId)
  const machines = useMachines()
  const sandboxes = useSandboxes()
  const said = useSaid(from)
  const [typed, setTyped] = useState<string | null>(null)
  const fromHome = useSyncExternalStore(
    noSubscription,
    () => {
      if (from) return null
      try {
        return window.sessionStorage.getItem('workbench.question')
      } catch {
        return null
      }
    },
    () => null,
  )
  const question = typed ?? (from ? said.data?.last : fromHome) ?? ''

  const findBlocked = findBlocker({
    question,
    project: project.data,
    sandboxes: sandboxes.data?.length,
    machines: machines.isSuccess ? machines.data.length : undefined,
  })
  return (
    <div className="h-full overflow-y-auto">
      <section className="mx-auto max-w-3xl space-y-4 px-6 py-8">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <label htmlFor="ask-question" className={cn(label, 'block')}>
          {t('question')}
        </label>
        <Textarea
          id="ask-question"
          rows={4}
          value={question}
          onChange={(event) => setTyped(event.target.value)}
          className="min-h-24"
        />
        <p id="ask-find-reason" role="status" tabIndex={-1} className="mb-2 text-sm">
          {findBlocked ? t(`blocker.${findBlocked}`) : null}
          {findBlocked === 'noMachine' || findBlocked === 'offline' ? (
            <ConnectComputerLink className="ml-2" />
          ) : null}
          {findBlocked === 'noSandbox' ? (
            <Link href={routes.settings(locale)} className="ml-2 underline">
              {t('toSettings')}
            </Link>
          ) : null}
        </p>

        <FormalExpertIntake
          blocked={findBlocked !== null}
          key={projectId}
          from={from}
          project={projectId}
          question={question}
          onSubmitted={setTyped}
          onRestore={typed === null ? setTyped : undefined}
        />
      </section>
    </div>
  )
}
