import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { HomeScreen } from '@/features/home'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('shell')
  return { title: t('brand'), robots: { index: false, follow: false } }
}

export default async function WorkbenchHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  if ('match' in query || 'expert' in query || ('knowbot' in query && 'task' in query)) notFound()
  return <HomeScreen />
}
