'use client'

import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConnectComputerLink } from '@/components/workbench/connect-computer'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  canMakeProjects,
  isRemote,
  cloneRepository,
  localProblemCode,
  makeFolder,
} from '@/lib/workbench/local-agent'
import { useLinkHandle, useMachines } from '@/lib/workbench/queries'
import { cn } from '@/lib/utils'

import { useProjectActions } from '../api/projects'
import {
  defaultTitle,
  fullDirectory,
  onlyMachine,
  pathProblem,
  repoFolder,
  rootsOf,
} from '../model/projects'

const label = 'text-muted-foreground mb-1.5 block text-xs font-medium'
const choice = 'hover:bg-muted/60 w-full rounded-lg border px-3 py-2 text-left text-sm'

type Mode = 'folder' | 'clone'
type Busy = 'making' | 'cloning' | 'registering' | null

// 新建项目（0024）：选机器（只有一台就跳过）、选工作区，再「新建文件夹」或「拉取仓库」。
// 先请这台电脑上的代理把文件夹建好或把仓库拉好，再去工作台登记——不再登记电脑上不存在的目录。
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
  preset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: string) => void
  // 从侧边栏某个工作区的「+」进来：电脑和目录已经定了
  preset?: { environment_id: string; workspace_root: string } | null
}) {
  const t = useTranslations('projects.create')
  const machines = useMachines()
  const { create } = useProjectActions()
  const all = machines.data ?? []
  const [picked, setPicked] = useState<string | null>(preset?.environment_id ?? null)
  const [root, setRoot] = useState<string | null>(preset?.workspace_root ?? null)
  const [mode, setMode] = useState<Mode>('folder')
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')
  const [title, setTitle] = useState('')
  // 仓库要登录时才出现；令牌只在这里的内存里，发往本机代理，关掉对话框就清
  const [asking, setAsking] = useState(false)
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const stop = useRef<AbortController | null>(null)

  const machine = picked ?? onlyMachine(all)
  const roots = rootsOf(all, machine)
  const workspace = root && roots.includes(root) ? root : roots.length === 1 ? roots[0] : null
  // 这台是装有本地 link 的电脑就直连回环口；是远程登录 link 的电脑就经工作台转发（账 165）
  const local = useLinkHandle(workspace ? machine : null)
  const agent = local.data && canMakeProjects(local.data) ? local.data : null
  const remote = !!local.data && isRemote(local.data)
  const relative = mode === 'clone' && !path.trim() ? repoFolder(url) : path
  const wrong = pathProblem(relative)
  const ready =
    machines.isSuccess &&
    !!machine &&
    !!workspace &&
    !!agent &&
    wrong === null &&
    busy === null &&
    (mode === 'folder' || (!!url.trim() && !!relative.trim() && (!asking || !!token)))

  function close(next: boolean) {
    if (!next) {
      stop.current?.abort()
      setToken('')
      setAsking(false)
      setProblem(null)
    }
    onOpenChange(next)
  }

  async function submit() {
    if (!ready || !agent || !workspace || !machine) return
    const directory = fullDirectory(workspace, relative)
    const controller = new AbortController()
    stop.current = controller
    setProblem(null)
    try {
      if (mode === 'folder') {
        setBusy('making')
        await makeFolder(agent, directory)
      } else {
        setBusy('cloning')
        await cloneRepository(
          agent,
          {
            url: url.trim(),
            path: directory,
            auth: asking
              ? { token, remember, ...(username.trim() ? { username: username.trim() } : {}) }
              : undefined,
          },
          controller.signal,
        )
      }
      setBusy('registering')
      const made = await create.mutateAsync({
        environment_id: machine,
        workspace_root: workspace,
        path: relative.trim(),
        title,
      })
      setToken('')
      setAsking(false)
      onCreated(made.id)
    } catch (error) {
      const code = controller.signal.aborted ? 'cancelled' : localProblemCode(error)
      if (code === 'auth_required') setAsking(true)
      setProblem(code)
    } finally {
      setBusy(null)
      stop.current = null
    }
  }

  const agentNote = !workspace
    ? null
    : local.isPending
      ? t('agent.checking')
      : local.isError
        ? t.has(`agent.${localProblemCode(local.error)}`)
          ? t(`agent.${localProblemCode(local.error)}`)
          : t('agent.failed')
        : !agent
          ? t(remote ? 'agent.remoteOutdated' : 'agent.outdated')
          : remote
            ? t('agent.remote')
            : null

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {machines.isPending ? <p role="status">{t('loadingMachines')}</p> : null}
          {machines.isError ? (
            <div role="alert">
              <p>{t('machinesFailed')}</p>
              <button type="button" className="underline" onClick={() => void machines.refetch()}>
                {t('retryMachines')}
              </button>
            </div>
          ) : null}
          {machines.isSuccess && all.length === 0 ? (
            <div className="space-y-3">
              <p>{t('noMachine')}</p>
              <ConnectComputerLink />
            </div>
          ) : null}
          {machines.isSuccess && machine && roots.length === 0 ? (
            <div className="space-y-3">
              <p>{t('noRoots')}</p>
              <ConnectComputerLink />
            </div>
          ) : null}
          {all.length > 1 ? (
            <div>
              <span className={label}>{t('machine')}</span>
              <ul className="space-y-1.5">
                {all.map((each) => (
                  <li key={each.id}>
                    <button
                      type="button"
                      aria-pressed={machine === each.id}
                      onClick={() => {
                        setPicked(each.id)
                        setRoot(null)
                      }}
                      className={cn(choice, machine === each.id && 'border-foreground bg-muted/60')}
                    >
                      {each.name}
                      {each.status === 'online' ? '' : t('machineOffline')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {machine ? (
            <div>
              <span className={label}>{t('workspace')}</span>
              <ul className="space-y-1.5">
                {roots.map((each) => (
                  <li key={each}>
                    <button
                      type="button"
                      aria-pressed={workspace === each}
                      onClick={() => setRoot(each)}
                      className={cn(
                        choice,
                        'font-mono text-[13px]',
                        workspace === each && 'border-foreground bg-muted/60',
                      )}
                    >
                      {each}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {agentNote ? (
            <p role={local.isPending ? 'status' : 'alert'} className="text-[13px]">
              {agentNote}
            </p>
          ) : null}

          {workspace ? (
            <>
              <div className="flex gap-2" role="group" aria-label={t('how')}>
                {(['folder', 'clone'] as const).map((each) => (
                  <Button
                    key={each}
                    type="button"
                    size="sm"
                    variant={mode === each ? 'default' : 'outline'}
                    aria-pressed={mode === each}
                    disabled={busy !== null}
                    onClick={() => {
                      setMode(each)
                      setProblem(null)
                    }}
                  >
                    {t(each === 'folder' ? 'modeFolder' : 'modeClone')}
                  </Button>
                ))}
              </div>
              {mode === 'clone' ? (
                <div>
                  <label htmlFor="project-repo" className={label}>
                    {t('repo')}
                  </label>
                  <Input
                    id="project-repo"
                    value={url}
                    placeholder="https://github.com/owner/repo.git"
                    onChange={(event) => {
                      setUrl(event.target.value)
                      setAsking(false)
                    }}
                    className="font-mono"
                  />
                  <p className="text-muted-foreground mt-1.5 text-[13px]">{t('repoHint')}</p>
                </div>
              ) : null}
              <div>
                <label htmlFor="project-path" className={label}>
                  {t('path')}
                </label>
                <Input
                  id="project-path"
                  value={path}
                  placeholder={mode === 'clone' ? repoFolder(url) : undefined}
                  onChange={(event) => setPath(event.target.value)}
                  aria-invalid={wrong !== null}
                  className="font-mono"
                />
                <p className="text-muted-foreground mt-1.5 text-[13px]">
                  {mode === 'clone' ? t('clonePathHint') : t('pathHint')}
                </p>
                {wrong ? (
                  <p role="alert" className="text-destructive mt-1 text-[13px]">
                    {t(`problem.${wrong}`)}
                  </p>
                ) : (
                  <p className="mt-1 text-[13px]">
                    <span className="text-muted-foreground">{t('directory')}：</span>
                    <span className="font-mono">{fullDirectory(workspace, relative)}</span>
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="project-name" className={label}>
                  {t('name')}
                </label>
                <Input
                  id="project-name"
                  value={title}
                  maxLength={400}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <p className="text-muted-foreground mt-1.5 text-[13px]">
                  {t('nameHint', { title: defaultTitle(workspace, relative) })}
                </p>
              </div>
            </>
          ) : null}

          {mode === 'clone' && asking ? (
            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{t('auth.title')}</legend>
              <p className="text-muted-foreground text-[13px]">
                {t(remote ? 'auth.remoteLead' : 'auth.lead')}
              </p>
              <div>
                <label htmlFor="project-username" className={label}>
                  {t('auth.username')}
                </label>
                <Input
                  id="project-username"
                  value={username}
                  autoComplete="off"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="project-token" className={label}>
                  {t('auth.token')}
                </label>
                <Input
                  id="project-token"
                  type="password"
                  value={token}
                  autoComplete="off"
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="mt-0.5"
                />
                {t('auth.remember')}
              </label>
            </fieldset>
          ) : null}

          {busy ? (
            <p role="status" className="text-[13px]">
              {t(busy)}
            </p>
          ) : null}
          {problem ? (
            <p role="alert" className="text-destructive text-[13px]">
              {t.has(`problem.${problem}`) ? t(`problem.${problem}`) : t('problem.other')}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {busy === 'cloning' ? (
            <Button variant="outline" onClick={() => stop.current?.abort()}>
              {t('cancelClone')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => close(false)}>
              {t('cancel')}
            </Button>
          )}
          <Button disabled={!ready} onClick={() => void submit()}>
            {busy
              ? t('submitting')
              : mode === 'clone'
                ? asking
                  ? t('auth.retry')
                  : t('submitClone')
                : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
