'use client'

import { FolderIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useProjects } from '@/lib/workbench/queries'

// 「选一个项目」。聊天放进项目、聊天转为工作、请专家之前都要用。
export function ProjectPicker({
  open,
  onOpenChange,
  title,
  description,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onPick: (project: string) => void
}) {
  const t = useTranslations('projectPicker')
  const projects = useProjects()
  const usable = (projects.data ?? []).filter((project) => !project.archived)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {projects.isError ? (
          <div role="alert">
            {t('failed')}{' '}
            <button type="button" onClick={() => void projects.refetch()}>
              {t('retry')}
            </button>
          </div>
        ) : projects.isPending ? (
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        ) : usable.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('none')}</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto">
            {usable.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => onPick(project.id)}
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
                >
                  <FolderIcon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{project.title}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {project.environment_name} · {project.directory}
                      {project.online ? '' : `（${t('offline')}）`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
