import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'

import { SettingsScreen } from '@/features/settings'
import { routes, SETTINGS_SECTIONS, type SettingsSection } from '@/lib/workbench/routes'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings')
  return { title: t('title'), robots: { index: false, follow: false } }
}

// 设置分三类（0021）：/settings/preferences、/settings/cloud、/settings/computer
export default async function WorkbenchSettingsSectionPage({
  params,
}: {
  params: Promise<{ locale: string; section: string }>
}) {
  const { locale, section } = await params
  if (section === 'method-skill-center') redirect(routes.methods(locale))
  if (!(SETTINGS_SECTIONS as readonly string[]).includes(section)) notFound()
  return <SettingsScreen section={section as SettingsSection} />
}
