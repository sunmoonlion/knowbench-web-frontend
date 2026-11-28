'use client'

import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { CrossAppLink } from '@/components/common/cross-app-link'
import { useWorkbench } from '@/lib/workbench/context'
import { WorkbenchError } from '@/lib/workbench/http'
import { KNOWBOT_REF, usePinKnowbot } from '@/lib/workbench/knowbots'
import { routes } from '@/lib/workbench/routes'

// Confirm a new market installation before returning to the expert directory.
export function KnowbotArrival() {
  const search = useSearchParams()
  const given = search.get('knowbot')
  const ref = given && KNOWBOT_REF.test(given) ? given : null
  return ref ? <PinArrival key={ref} reference={ref} /> : null
}

function PinArrival({ reference }: { reference: string }) {
  const t = useTranslations('home.knowbot')
  const router = useRouter()
  const { locale } = useWorkbench()
  const pin = usePinKnowbot()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    pin.mutate(reference, {
      onSuccess: () => router.replace(routes.expert(locale)),
    })
  }, [reference, pin, router, locale])

  if (pin.isError) {
    const code = pin.error instanceof WorkbenchError ? pin.error.code : ''
    const said =
      code === 'no_such_expert'
        ? t('notFound')
        : code === 'knowbot_unavailable'
          ? t('unavailable')
          : code === 'knowbot_invalid'
            ? t('invalid')
            : t('failed')
    return (
      <section role="alert" className="space-y-2 rounded-xl border border-amber-300 p-4 text-sm">
        <p>{said}</p>
        <CrossAppLink
          to="knowmart.knowbots"
          refValue="expert"
          className="underline underline-offset-3"
        >
          {t('again')}
        </CrossAppLink>
      </section>
    )
  }
  return (
    <p className="text-muted-foreground text-center text-sm" role="status">
      {t('checking')}
    </p>
  )
}
