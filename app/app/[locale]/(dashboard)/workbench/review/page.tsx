import { notFound } from 'next/navigation'
import { z } from 'zod'
import { BranchRouteScreen, ReviewDecisions } from '@/features/expert'
import { branchLink } from '@/lib/workbench/reviewer'

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  if (params.task !== undefined) {
    const task = z.uuid().safeParse(params.task)
    if (!task.success) notFound()
    return (
      <main className="mx-auto max-w-3xl p-6">
        <ReviewDecisions key={task.data} task={task.data} />
      </main>
    )
  }
  const link = branchLink.safeParse(params)
  if (!link.success) notFound()
  return <BranchRouteScreen key={JSON.stringify(link.data)} link={link.data} />
}
