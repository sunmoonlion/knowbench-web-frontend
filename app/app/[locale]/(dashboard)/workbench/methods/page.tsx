import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { MethodSkillCenterSection } from '@/features/methods'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('methodSkillCenter')
  return { title: t('title'), robots: { index: false, follow: false } }
}

export default function MethodsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 lg:px-6 lg:py-10">
        <MethodSkillCenterSection />
      </div>
    </div>
  )
}
