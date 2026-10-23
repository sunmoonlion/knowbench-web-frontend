import { redirect } from 'next/navigation'

import { routes } from '@/lib/workbench/routes'

// 旧的「知识库」单份资料页（按交回物算出来的那一版）：10-23 起换成云端知识库，没有单份页了（SDD 0042）
export default async function LibraryItemPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect(routes.library(locale))
}
