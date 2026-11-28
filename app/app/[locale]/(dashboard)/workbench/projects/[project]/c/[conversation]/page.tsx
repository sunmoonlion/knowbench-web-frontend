import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'


import { ConversationView } from './conversation-view'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('shell')
  return { title: t('mode.work'), robots: { index: false, follow: false } }
}

// 项目里的对话：聊天或工作。
export default async function ProjectConversationPage({
  params,
}: {
  params: Promise<{ project: string; conversation: string }>
}) {
  const { project, conversation } = await params
  return <ConversationView conversation={conversation} project={project} />
}
