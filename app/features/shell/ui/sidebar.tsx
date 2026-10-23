'use client'

import {
  BookOpenIcon,
  BrainIcon,
  ChevronRightIcon,
  FolderIcon,
  GraduationCapIcon,
  MessageSquareIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ResizeHandle } from '@/components/common/resize-handle'
import { Button } from '@/components/ui/button'
import { LogoutButton } from '@/components/auth/logout-button'
import { useWorkbench } from '@/lib/workbench/context'
import {
  useConversations,
  useMachines,
  usePending,
  useProjects,
  useWorkspaces,
} from '@/lib/workbench/queries'
import { usePreferences } from '@/lib/preferences'
import { clampWidth, PANE_LIMITS, usePaneWidths } from '@/lib/pane-widths'
import type { WorkbenchError } from '@/lib/workbench/http'
import { useRemove } from '@/lib/workbench/remove'
import { MODES, routes } from '@/lib/workbench/routes'
import { cn } from '@/lib/utils'

import {
  FOOT,
  computerTree,
  footHref,
  looseChats,
  modeOf,
  pendingPointers,
  recent,
  type TreeConversation,
} from '../model/nav'

const row = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] leading-5'
const rowLink = 'hover:bg-foreground/5'
const rowActive = 'bg-foreground/[0.07] font-medium'
const heading = 'text-muted-foreground px-2 pb-1 text-xs font-medium'

// 还没做的页：显示出来，但不是链接
function Destination({
  href,
  active = false,
  className,
  children,
}: {
  href: string | null
  active?: boolean
  className?: string
  children: React.ReactNode
}) {
  const t = useTranslations('shell')
  if (href === null) {
    return (
      <span
        aria-disabled="true"
        title={t('notBuilt')}
        className={cn(row, 'text-muted-foreground cursor-default', className)}
      >
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(row, rowLink, active && rowActive, className)}
    >
      {children}
    </Link>
  )
}

function KindIcon({ kind, label }: { kind: TreeConversation['kind']; label: string }) {
  const className = 'size-3.5 shrink-0'
  if (kind === 'chat') return <MessageSquareIcon className={className} aria-label={label} />
  if (kind === 'expert') return <GraduationCapIcon className={className} aria-label={label} />
  return <WrenchIcon className={className} aria-label={label} />
}

// 行尾的「删除」：先一个小垃圾桶，点了换成「确定删除 / 取消」，不弹浏览器对话框
function RemoveControl({
  label,
  asking,
  onAsk,
  onCancel,
  onConfirm,
  busy = false,
}: {
  label: string
  asking: boolean
  onAsk: () => void
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
}) {
  const t = useTranslations('shell')
  if (!asking) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={onAsk}
        className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
      >
        <Trash2Icon className="size-3.5" />
      </button>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs" title={t('remove.note')}>
      <button
        type="button"
        disabled={busy}
        onClick={onConfirm}
        className="rounded bg-red-600 px-1.5 py-0.5 text-white disabled:opacity-50"
      >
        {t('remove.confirm')}
      </button>
      <button type="button" onClick={onCancel} className="rounded border px-1.5 py-0.5">
        {t('remove.cancel')}
      </button>
    </span>
  )
}

export function Sidebar() {
  const t = useTranslations('shell')
  const tAuth = useTranslations('auth')
  const { csrfToken, locale, user } = useWorkbench()
  const pathname = usePathname()
  const search = useSearchParams().toString()

  const workspaces = useWorkspaces()
  const projects = useProjects()
  const conversations = useConversations()
  const pending = usePending()
  const machines = useMachines()
  // 账 92：探一下本机回环口，知道「这台电脑还没接入」还是「就是这台」

  const allProjects = projects.data ?? []
  const here = (conversations.data ?? []).find((c) => pathname.includes(c.id))
  const mode = modeOf(pathname, search, here)
  const waiting = pending.data?.length ?? 0
  // 侧栏只留电脑名与项目，不挂连没连着这类状态（会合点备忘第六节，账 143）；要用户做事时工作台顶上单独提示
  const tree = computerTree(
    machines.data ?? [],
    workspaces.data ?? [],
    allProjects,
    conversations.data ?? [],
    locale,
  )
  const loose = looseChats(conversations.data ?? [], locale)
  // 当前项目所在的工作区默认展开，其余折叠；手动开合记在这一次
  const currentProject = allProjects.find((project) => pathname.includes(project.id))
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  // 个人偏好（0021）：侧边栏宽度与默认展开到哪一级
  const { preferences, restore } = usePreferences()
  useEffect(() => restore(), [restore])
  // 拖过分割线就用拖出来的宽度，没拖过按偏好的窄、中、宽（所有者 2026-10-17）
  const panes = usePaneWidths()
  const tp = useTranslations('panes')
  const restorePanes = usePaneWidths((state) => state.restore)
  useEffect(() => restorePanes(), [restorePanes])
  const preferred = { narrow: 208, normal: 240, wide: 288 }[preferences.sidebar]
  const width = panes.widths.sidebar ?? preferred
  // 哪一行正在问「确定删除？」
  const [asking, setAsking] = useState<string | null>(null)
  const remove = useRemove()
  const router = useRouter()
  const removeProject = (id: string) =>
    remove.project.mutate(id, {
      onSuccess: () => {
        setAsking(null)
        if (pathname.includes(id)) router.push(routes.home(locale))
      },
    })
  const removeConversation = (id: string) =>
    remove.conversation.mutate(id, {
      onSuccess: () => {
        setAsking(null)
        if (pathname.includes(id)) router.push(routes.home(locale))
      },
    })
  const [showPending, setShowPending] = useState(false)
  const pointers = pendingPointers(pending.data ?? [], locale)
  const isOpen = (key: string, fallback: boolean) => toggled[key] ?? fallback
  const flip = (key: string, fallback: boolean) =>
    setToggled({ ...toggled, [key]: !isOpen(key, fallback) })
  const waitingIn = (projectId: string) =>
    (pending.data ?? []).filter((each) => each.where.project?.id === projectId).length

  if (panes.sidebarCollapsed) {
    return (
      <aside
        aria-label={t('brand')}
        data-state="collapsed"
        className="bg-muted/40 flex h-full w-10 shrink-0 flex-col items-center gap-1 border-r py-2"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={tp('expandSidebar')}
          title={tp('expandSidebar')}
          onClick={() => panes.collapseSidebar(false)}
        >
          <PanelLeftOpenIcon />
        </Button>
        {user ? (
          <span
            aria-label={tAuth('signedInAs', { name: user.name })}
            title={tAuth('signedInAs', { name: user.name })}
            className="bg-foreground/10 mt-auto flex size-6 items-center justify-center rounded-full text-xs font-medium"
          >
            {[...user.name][0]?.toUpperCase()}
          </span>
        ) : null}
      </aside>
    )
  }
  return (
    <aside
      aria-label={t('brand')}
      data-state="open"
      style={{ width }}
      className="bg-muted/40 relative flex h-full shrink-0 flex-col gap-4 border-r p-3"
    >
      <ResizeHandle
        edge="right"
        width={width}
        min={PANE_LIMITS.sidebar.min}
        max={PANE_LIMITS.sidebar.max}
        label={tp('sidebar')}
        hint={tp('hint')}
        onResize={(next) =>
          panes.set(
            'sidebar',
            clampWidth(
              'sidebar',
              next,
              window.innerWidth,
              panes.widths.side ?? PANE_LIMITS.side.fallback,
            ),
          )
        }
        onReset={() => panes.set('sidebar', null)}
      />
      <div className="flex items-center justify-between gap-1">
        <Link href={routes.home(locale)} className="px-2 pt-1 text-sm font-semibold">
          {t('brand')}
        </Link>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={tp('collapseSidebar')}
          title={tp('collapseSidebar')}
          onClick={() => panes.collapseSidebar(true)}
        >
          <PanelLeftCloseIcon />
        </Button>
      </div>

      {/* 三个标签就是新建入口：点哪个，中间出哪种对话框（0017）。不再有单独的「新建」钮 */}
      <nav
        aria-label={t('modes')}
        className="bg-muted grid grid-cols-3 gap-0.5 rounded-lg border p-0.5"
      >
        {MODES.map((each) => (
          <Link
            key={each}
            href={routes.home(locale, each)}
            aria-current={mode === each ? 'true' : undefined}
            className={cn(
              'rounded-md py-1 text-center text-[13px]',
              mode === each
                ? 'bg-background font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`mode.${each}`)}
          </Link>
        ))}
      </nav>

      {/* 中间这一段自己滚：电脑 → 工作区 → 项目 → 对话 */}
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
        <section aria-label={t('computers')}>
          <h2 className={heading}>{t('computers')}</h2>
          {machines.isPending ? (
            <p className="text-muted-foreground px-2 text-xs">{t('loading')}</p>
          ) : tree.length === 0 ? (
            <p className="text-muted-foreground px-2 text-xs">
              {t('computer.none')}{' '}
              <Link href={routes.computer(locale)} className="underline underline-offset-3">
                {t('computer.connect')}
              </Link>
            </p>
          ) : (
            <ul className="space-y-1">
              {tree.map((machine) => (
                <li key={machine.id}>
                  <div className={cn(row, 'font-medium')}>
                    <span className="truncate">{machine.name}</span>
                    <Link
                      href={routes.computer(locale)}
                      className="text-muted-foreground hover:text-foreground ml-auto text-xs font-normal"
                    >
                      {t('computer.manage')}
                    </Link>
                  </div>
                  {machine.workspaces.length === 0 ? (
                    <p className="text-muted-foreground px-7 text-xs">{t('workspace.none')}</p>
                  ) : (
                    <ul>
                      {machine.workspaces.map((workspace) => {
                        const holdsCurrent = workspace.projects.some(
                          (each) => each.project.id === currentProject?.id,
                        )
                        const openByDefault =
                          holdsCurrent ||
                          machine.workspaces.length === 1 ||
                          preferences.expand !== 'computer'
                        const open = isOpen(workspace.key, openByDefault)
                        const name = workspace.root.split(/[\\/]/).pop() || workspace.root
                        const listHref = `${routes.projects(locale)}?workspace=${encodeURIComponent(workspace.key)}`
                        return (
                          <li key={workspace.key}>
                            <div className={cn(row, rowLink, 'pl-4')}>
                              <button
                                type="button"
                                onClick={() => flip(workspace.key, openByDefault)}
                                aria-expanded={open}
                                title={workspace.root}
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              >
                                <ChevronRightIcon
                                  className={cn(
                                    'text-muted-foreground size-3.5 shrink-0 transition-transform',
                                    open && 'rotate-90',
                                  )}
                                />
                                <span className="truncate">{name}</span>
                              </button>
                              <Link
                                href={listHref}
                                className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
                              >
                                {t('workspace.all')}
                              </Link>
                              <Link
                                href={`${listHref}&new=1`}
                                aria-label={t('workspace.add', { name })}
                                className="text-muted-foreground hover:text-foreground shrink-0"
                              >
                                <PlusIcon className="size-3.5" />
                              </Link>
                            </div>
                            {open ? (
                              <ul>
                                {workspace.projects.length === 0 ? (
                                  <li>
                                    <Link
                                      href={`${listHref}&new=1`}
                                      className={cn(
                                        row,
                                        rowLink,
                                        'text-muted-foreground pl-9 text-xs',
                                      )}
                                    >
                                      <PlusIcon className="size-3 shrink-0" />
                                      {t('project.new')}
                                    </Link>
                                  </li>
                                ) : null}
                                {workspace.projects.map(
                                  ({ project, busy, conversations: talks }) => {
                                    const expandedByDefault =
                                      project.id === currentProject?.id ||
                                      preferences.expand === 'project'
                                    const expanded = isOpen(project.id, expandedByDefault)
                                    const waitingHere = waitingIn(project.id)
                                    return (
                                      <li key={project.id}>
                                        <div
                                          className={cn(
                                            row,
                                            rowLink,
                                            'group pl-9',
                                            pathname.includes(project.id) && rowActive,
                                          )}
                                        >
                                          <button
                                            type="button"
                                            aria-expanded={expanded}
                                            aria-label={t('project.toggle', {
                                              title: project.title,
                                            })}
                                            onClick={() => flip(project.id, expandedByDefault)}
                                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                          >
                                            <FolderIcon className="size-3.5 shrink-0" />
                                            <span className="truncate">{project.title}</span>
                                          </button>
                                          {busy ? (
                                            <span
                                              className="size-1.5 shrink-0 rounded-full bg-amber-500"
                                              title={t('busy')}
                                            />
                                          ) : null}
                                          {waitingHere > 0 ? (
                                            <span className="bg-foreground text-background rounded-full px-1 text-[10px]">
                                              {waitingHere}
                                            </span>
                                          ) : null}
                                          <Link
                                            href={`${routes.home(locale, mode === 'chat' ? 'work' : mode)}&project=${project.id}`}
                                            aria-label={t('project.add', { title: project.title })}
                                            className="text-muted-foreground hover:text-foreground shrink-0"
                                          >
                                            <PlusIcon className="size-3.5" />
                                          </Link>
                                          <RemoveControl
                                            label={t('project.remove', { title: project.title })}
                                            asking={asking === project.id}
                                            busy={remove.project.isPending}
                                            onAsk={() => setAsking(project.id)}
                                            onCancel={() => setAsking(null)}
                                            onConfirm={() => removeProject(project.id)}
                                          />
                                        </div>
                                        {expanded ? (
                                          <ul>
                                            {talks.map((talk) => (
                                              <li
                                                key={talk.id}
                                                className="group flex items-center pr-2"
                                              >
                                                <Destination
                                                  href={talk.href}
                                                  active={pathname.includes(talk.id)}
                                                  className="min-w-0 flex-1 pl-14"
                                                >
                                                  <KindIcon
                                                    kind={talk.kind}
                                                    label={t(`mode.${talk.kind}`)}
                                                  />
                                                  <span className="truncate">
                                                    {talk.title ?? t('untitled')}
                                                  </span>
                                                  {talk.busy ? (
                                                    <span
                                                      className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500"
                                                      title={t('busy')}
                                                    />
                                                  ) : null}
                                                </Destination>
                                                <RemoveControl
                                                  label={t('conversation.remove', {
                                                    title: talk.title ?? t('untitled'),
                                                  })}
                                                  asking={asking === talk.id}
                                                  busy={remove.conversation.isPending}
                                                  onAsk={() => setAsking(talk.id)}
                                                  onCancel={() => setAsking(null)}
                                                  onConfirm={() => removeConversation(talk.id)}
                                                />
                                              </li>
                                            ))}
                                            {talks.length === 0 ? (
                                              <li className="text-muted-foreground pl-14 text-xs">
                                                {t('project.noTalks')}
                                              </li>
                                            ) : null}
                                          </ul>
                                        ) : null}
                                      </li>
                                    )
                                  },
                                )}
                              </ul>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {loose.length > 0 ? (
          <section aria-label={t('chats')}>
            <h2 className={heading}>{t('chats')}</h2>
            <ul>
              {loose.map((talk) => (
                <li key={talk.id} className="group flex items-center pr-2">
                  <Destination
                    href={talk.href}
                    active={pathname.includes(talk.id)}
                    className="min-w-0 flex-1"
                  >
                    <KindIcon kind={talk.kind} label={t('mode.chat')} />
                    <span className="truncate">{talk.title ?? t('untitled')}</span>
                  </Destination>
                  {/* 同一段对话可能同时在「聊天」和「最近」里：问「确定删除」只在点的那一行 */}
                  <RemoveControl
                    label={t('conversation.remove', { title: talk.title ?? t('untitled') })}
                    asking={asking === `chat:${talk.id}`}
                    busy={remove.conversation.isPending}
                    onAsk={() => setAsking(`chat:${talk.id}`)}
                    onCancel={() => setAsking(null)}
                    onConfirm={() => removeConversation(talk.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label={t('recent')}>
          <h2 className={heading}>{t('recent')}</h2>
          {remove.conversation.isError ? (
            <p role="alert" className="text-destructive px-2 pb-1 text-xs">
              {t(
                (remove.conversation.error as WorkbenchError | null)?.code === 'project_busy'
                  ? 'remove.busy'
                  : 'remove.failed',
              )}
            </p>
          ) : null}
          <ul>
            {recent(conversations.data ?? [], allProjects, locale).map((item) => (
              <li key={item.id} className="group flex items-center pr-2">
                <Destination
                  href={item.href}
                  active={pathname.includes(item.id)}
                  className="min-w-0 flex-1"
                >
                  <KindIcon kind={item.kind} label={t(`mode.${item.kind}`)} />
                  <span className="truncate">{item.title ?? t('untitled')}</span>
                  {item.project ? (
                    <span className="text-muted-foreground ml-1 truncate text-xs">
                      · {item.project}
                    </span>
                  ) : null}
                  {item.busy ? (
                    <span
                      className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500"
                      title={t('busy')}
                    />
                  ) : null}
                </Destination>
                {/* 专家正在这段对话里干活时服务端不许删：不摆按钮，免得点了没反应 */}
                {item.busy ? null : (
                  <RemoveControl
                    label={t('conversation.remove', { title: item.title ?? t('untitled') })}
                    asking={asking === `recent:${item.id}`}
                    busy={remove.conversation.isPending}
                    onAsk={() => setAsking(`recent:${item.id}`)}
                    onCancel={() => setAsking(null)}
                    onConfirm={() => removeConversation(item.id)}
                  />
                )}
              </li>
            ))}
            {conversations.data?.length === 0 ? (
              <li className="text-muted-foreground px-2 py-1 text-xs">{t('noRecent')}</li>
            ) : null}
          </ul>
        </section>
      </div>

      <nav aria-label={t('more')} className="shrink-0 border-t pt-3">
        {showPending && pointers.length > 0 ? (
          <ul
            aria-label={t('pending.title')}
            className="bg-background mx-1 mb-2 max-h-64 divide-y overflow-y-auto rounded-md border text-[13px]"
          >
            {pointers.map((item) => (
              <li key={item.id}>
                <Destination href={item.href} className="flex-col items-start gap-0.5 py-2">
                  <span className="flex w-full items-center gap-2">
                    <span className="truncate font-medium">{item.about}</span>
                    {item.urgent ? (
                      <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                        {t('pending.urgent')}
                      </span>
                    ) : null}
                    {item.minutesLeft !== null && item.urgent ? (
                      <span className="text-muted-foreground ml-auto text-xs">
                        {t('pending.minutes', { minutes: item.minutesLeft })}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {[item.project, item.conversation, item.step].filter(Boolean).join(' · ')}
                  </span>
                </Destination>
              </li>
            ))}
          </ul>
        ) : null}
        {FOOT.map((entry) => {
          const href = footHref(entry, locale)
          if (entry.key === 'pending') {
            return (
              <button
                key={entry.key}
                type="button"
                aria-expanded={showPending}
                onClick={() => setShowPending(!showPending)}
                className={cn(row, rowLink, 'w-full text-left')}
              >
                <span>{t(`foot.${entry.key}`)}</span>
                {waiting > 0 ? (
                  <span className="bg-foreground text-background ml-auto rounded-full px-1.5 text-xs">
                    {waiting}
                  </span>
                ) : null}
              </button>
            )
          }
          return (
            <Destination
              key={entry.key}
              href={href}
              active={href === pathname && entry.key !== 'pending'}
            >
              {entry.key === 'settings' ? <SettingsIcon className="size-3.5 shrink-0" /> : null}
              {entry.key === 'library' ? <BookOpenIcon className="size-3.5 shrink-0" /> : null}
              {entry.key === 'memory' ? <BrainIcon className="size-3.5 shrink-0" /> : null}
              <span>{t(`foot.${entry.key}`)}</span>
              {entry.key === 'pending' && waiting > 0 ? (
                <span className="bg-foreground text-background ml-auto rounded-full px-1.5 text-xs">
                  {waiting}
                </span>
              ) : null}
            </Destination>
          )
        })}
        <div className="mt-2 space-y-1 px-2">
          {user ? (
            <p
              className="text-muted-foreground truncate text-xs"
              title={user.email ?? undefined}
            >
              {tAuth('signedInAs', { name: user.name })}
            </p>
          ) : null}
          <LogoutButton
            csrfToken={csrfToken}
            locale={locale}
            label={tAuth('logout')}
            errorLabel={tAuth('logoutFailed')}
          />
        </div>
      </nav>
    </aside>
  )
}
