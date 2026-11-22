import { notFound } from 'next/navigation'
import { BranchRouteScreen } from '@/features/expert'
import { branchLink } from '@/lib/workbench/reviewer'

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const link = branchLink.safeParse(await searchParams)
  if (!link.success) notFound()
  return <BranchRouteScreen key={JSON.stringify(link.data)} link={link.data} />
}
