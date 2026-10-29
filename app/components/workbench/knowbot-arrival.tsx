'use client'

import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { CrossAppLink } from '@/components/common/cross-app-link'
import { findResultSchema, projectDetailSchema } from '@/contracts/workbench-v2'
import { useWorkbench } from '@/lib/workbench/context'
import { getJson, seg, WorkbenchError } from '@/lib/workbench/http'
import { KNOWBOT_REF, usePinKnowbot } from '@/lib/workbench/knowbots'
import { routes } from '@/lib/workbench/routes'

const TASK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const QUESTION = 'workbench.question'

// 带着专家回来（链接带 knowbot=<分身>@<版本>）：从 knowmart「我的分身」选定的，或 knowlab 里孵出来、
// 能用了的。后端按会话核验、钉住，然后换到「专家」并选好这一位；链接上的 knowbot 随之去掉，刷新不会再请一次。
// knowlab 那份申请是在这里找专家没找到时建的，链接还带 task=那一轮找专家的编号（专家孵化方案第十三节
// 第 5 条）：取回当初那句问题和项目，直接到那个项目的请专家页，问题填好、这一位选好，你看过点了才交。
export function KnowbotArrival() {
  const t = useTranslations('home.knowbot')
  const router = useRouter()
  const { locale } = useWorkbench()
  const search = useSearchParams()
  const given = search.get('knowbot')
  const ref = given && KNOWBOT_REF.test(given) ? given : null
  const asked = search.get('task')
  const task = asked && TASK.test(asked) ? asked : null
  const pin = usePinKnowbot()
  const started = useRef(false)

  useEffect(() => {
    if (ref === null || started.current) return
    started.current = true
    pin.mutate(ref, {
      onSuccess: async (pack) => {
        const expert = encodeURIComponent(pack.id)
        const project = task ? await originalProject(task) : null
        router.replace(
          project
            ? `${routes.askExpert(locale, project)}?expert=${expert}`
            : `${routes.home(locale, 'expert')}&expert=${expert}`,
        )
      },
    })
  }, [ref, task, pin, router, locale])

  if (ref === null) return null
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

// 那一轮找专家在哪个项目、问的什么：取不到（不是你的、项目没了）就回专家首页，照常选好这一位
async function originalProject(task: string): Promise<string | null> {
  let found
  try {
    found = await getJson(findResultSchema, `/api/workbench/find-expert/${seg(task)}`)
    if (!found.project_id) return null
    await getJson(projectDetailSchema, `/api/workbench/projects/${seg(found.project_id)}`)
  } catch {
    return null
  }
  try {
    window.sessionStorage.setItem(QUESTION, found.question)
  } catch {
    // 浏览器不让存：照样去请专家页，问题自己再写一遍
  }
  return found.project_id
}
