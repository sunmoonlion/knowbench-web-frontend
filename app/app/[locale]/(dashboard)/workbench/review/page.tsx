import { notFound } from 'next/navigation'
import { z } from 'zod'
import { ReviewDecisions } from '@/features/expert'

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const task = z.uuid().safeParse(params.task)
  if (!task.success) notFound()
  return (
    <main className="mx-auto max-w-3xl p-6">
      <ReviewDecisions key={task.data} task={task.data} />
    </main>
  )
}
