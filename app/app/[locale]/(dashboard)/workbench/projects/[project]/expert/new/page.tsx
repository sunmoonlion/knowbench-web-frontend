import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { AskExpertScreen } from '@/features/expert'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('askExpert')
  return { title: t('title'), robots: { index: false, follow: false } }
}

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || null

// 请专家。两个入口：专家首页（带着选了哪一位），对话里（带着是哪段对话）。
export default async function AskExpertPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ project }, query] = await Promise.all([params, searchParams])
  if ('match' in query || 'expert' in query) notFound()
  return <AskExpertScreen project={project} from={one(query.from)} />
}
