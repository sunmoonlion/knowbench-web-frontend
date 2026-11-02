'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'

import { CrossAppLink } from '@/components/common/cross-app-link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DataRequest, ListedItem, Prematch, TaskData } from '@/contracts/workbench-v2'
import { WorkbenchError } from '@/lib/workbench/http'
import {
  type Changes,
  type Edit,
  chosenOf,
  confirmBody,
  edited,
  noChanges,
  normalSubject,
  periodOf,
  roughDuration,
  SUBJECT,
  unchosen,
  uploadValues,
  useTaskDataActions,
} from '@/lib/workbench/task-data'
import { cn } from '@/lib/utils'

const field =
  'border-input h-8 rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:border-ring'
// 自己加一样时能选的类型（词表里常用的几样）
const ADDABLE = [
  'annual_report',
  'semiannual_report',
  'q1_report',
  'q3_report',
  'interim_announcement',
  'prospectus',
  'research_company',
  'statistical_bulletin',
  'business_rule',
] as const
const THIS_YEAR = new Date().getFullYear()

// 这件委托用的数据（清单 v2 的专家，SDD 0043、decisions ⑭）。委托页与项目看板的卡片共用。
// 在定数据、在取、钉了哪几份；第 0 步或运行中专家提出的，等用户确认（能换一份、改主体或
// 期间、去掉、自己加一样），也可以不要、照现有的做；没取到的，用户定接着做还是停。
// 要去取的写明能不能取、预计多久、许可档（knowfeed 预切合，0043 第 3.3 节）；采不来的给去
// knowbase 直达上传的链接。
export function TaskDataPanel({
  task,
  data,
  compact = false,
}: {
  task: string
  data: TaskData
  compact?: boolean
}) {
  const t = useTranslations('expert.data')
  const act = useTaskDataActions(task)
  const [changes, setChanges] = useState<Changes>(noChanges)
  const duration = useDuration()
  if (!data.listed) return <NotSaved data={data} />
  const request = data.requests.find((each) => each.status === 'pending')
  const missing = data.requests.filter((each) => each.status === 'missing')
  const busy = act.confirm.isPending || act.decline.isPending || act.recheck.isPending
  const failure = (act.confirm.error ??
    act.decline.error ??
    act.recheck.error) as WorkbenchError | null
  const blocked = request ? unchosen(request, changes).length : 0

  return (
    <section
      aria-label={t('title')}
      className={cn('space-y-1.5 text-[13px]', !compact && 'shrink-0 border-b px-4 py-2')}
      data-testid="task-data"
    >
      {data.status === 'planning' ? <p className="text-muted-foreground">{t('planning')}</p> : null}
      {data.status === 'waiting' || data.supply_progress?.items.length ? (
        <SupplyProgress data={data} />
      ) : null}

      {request && data.confirm_in === 'knowlab' ? (
        <p className="text-amber-700 dark:text-amber-400" data-testid="task-data-elsewhere">
          {t('confirmInKnowlab', { items: request.labels.join('、') })}
        </p>
      ) : request ? (
        <div className="space-y-1.5" data-testid="task-data-request">
          <p className="text-amber-700 dark:text-amber-400">{t('requested')}</p>
          {typeof request.eta_seconds === 'number' ? (
            <p className="text-muted-foreground" data-testid="task-data-eta">
              {t('eta', { duration: duration(request.eta_seconds) })}
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {request.items.map((item) => (
              <ItemRow
                key={item.ref}
                task={task}
                onRecheck={() => act.recheck.mutate()}
                rechecking={act.recheck.isPending}
                item={item}
                need={request.needs.find((need) => need.key === item.need_key)}
                changes={changes}
                onChange={setChanges}
              />
            ))}
            {changes.added.map((add, n) => (
              <li key={`added-${n}`} className="rounded-lg border border-dashed p-2">
                <span className="font-medium">{t(`docType.${add.doc_type}`)}</span>{' '}
                <span className="text-muted-foreground text-xs">
                  {[add.subject ?? t('anySubject'), `${add.from}–${add.to}`].join(' · ')}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground ml-2 text-xs underline underline-offset-3"
                  onClick={() =>
                    setChanges({ ...changes, added: changes.added.filter((_, i) => i !== n) })
                  }
                >
                  {t('remove')}
                </button>
              </li>
            ))}
          </ul>
          <AddItem onAdd={(add) => setChanges({ ...changes, added: [...changes.added, add] })} />
          {blocked ? (
            <p className="text-amber-700 dark:text-amber-400">
              {t('unchosen', { count: blocked })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || blocked > 0}
              onClick={() =>
                act.confirm.mutate(confirmBody(request, changes), {
                  onSuccess: () => setChanges(noChanges),
                })
              }
            >
              {act.confirm.isPending ? t('confirming') : t('confirm')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => act.decline.mutate()}
            >
              {t('decline')}
            </Button>
          </div>
        </div>
      ) : null}

      {missing.length ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="task-data-missing">
          <p className="w-full text-amber-700 dark:text-amber-400">
            {t('missingSummary', { count: missing.flatMap((each) => each.missing).length })}
          </p>
          <details className="text-muted-foreground w-full">
            <summary className="cursor-pointer">{t('missingDetails')}</summary>
            <ul className="list-disc space-y-1 pl-5">
              {missing
                .flatMap((each) => each.missing)
                .map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
            </ul>
          </details>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act.recheck.mutate()}>
            {t('reviewAgain')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => act.decline.mutate()}>
            {t('goOn')}
          </Button>
          <span className="text-muted-foreground">{t('stopHint')}</span>
        </div>
      ) : null}

      {failure ? (
        <p role="alert" className="text-destructive">
          {t.has(`problems.${failure.code}`) ? t(`problems.${failure.code}`) : t('problem')}
        </p>
      ) : null}
      {data.incomplete.length ? (
        <p className="text-muted-foreground">
          {t('incomplete', { items: data.incomplete.join('；') })}
        </p>
      ) : null}
      <NotSaved data={data} />
      {!compact && data.pinned.length ? (
        <p className="text-muted-foreground truncate">
          {t('pinned', {
            count: data.pinned.length,
            names: data.pinned.map((each) => each.name).join(' · '),
          })}
        </p>
      ) : null}
    </section>
  )
}

// 预计多久的写法（「5 分钟」「3 小时」）
function useDuration() {
  const t = useTranslations('expert.data')
  return (seconds: number) => {
    const { unit, n } = roughDuration(seconds)
    return t(`duration.${unit}`, { n })
  }
}

// 预切合的结果：能取的写预计与许可档，取不到的写为什么
function PrematchLine({ prematch }: { prematch: Prematch }) {
  const t = useTranslations('expert.data')
  const duration = useDuration()
  const parts: string[] = []
  if (prematch.status === 'available') {
    parts.push(
      typeof prematch.eta_seconds === 'number'
        ? t('prematch.available', { duration: duration(prematch.eta_seconds) })
        : t('prematch.availableNoEta'),
    )
    if (prematch.license) parts.push(t('prematch.license', { license: prematch.license }))
    if (prematch.readings_missing.length) parts.push(t('prematch.readingsMissing'))
  } else if (prematch.status === 'unavailable') {
    parts.push(t('prematch.unavailable', { reason: prematch.reason ?? 'other' }))
  } else {
    parts.push(t(`prematch.${prematch.status}`))
  }
  return (
    <p
      className={cn(
        'mt-1 text-xs',
        prematch.status === 'available'
          ? 'text-muted-foreground'
          : 'text-amber-700 dark:text-amber-400',
      )}
      data-testid="task-data-prematch"
    >
      {parts.join(' · ')}
    </p>
  )
}

// 成稿没存进 knowbase 的：一份一行，写明原因（内置专家的委托也显示）
function NotSaved({ data }: { data: TaskData }) {
  const t = useTranslations('expert.data')
  if (!data.outputs_not_saved.length) return null
  return (
    <ul
      className="text-muted-foreground space-y-0.5 text-[13px]"
      data-testid="task-output-not-saved"
    >
      {data.outputs_not_saved.map((each) => (
        <li key={each.path}>
          {t('notSaved', {
            name: each.path.split('/').pop() ?? each.path,
            reason: each.reason ?? '—',
          })}
        </li>
      ))}
    </ul>
  )
}

function ItemRow({
  task,
  onRecheck,
  rechecking,
  item,
  need,
  changes,
  onChange,
}: {
  task: string
  onRecheck: () => void
  rechecking: boolean
  item: ListedItem
  need: DataRequest | undefined
  changes: Changes
  onChange: (next: Changes) => void
}) {
  const t = useTranslations('expert.data')
  const [editing, setEditing] = useState(false)
  const off = changes.dropped.includes(item.ref)
  const edit = need ? changes.edits[need.key] : undefined
  const shown = need ? edited(need, edit) : undefined
  const pool = [...item.chosen, ...item.candidates]
  const chosen = chosenOf(item, changes.picks)
  const subject = edit?.subject !== undefined ? edit.subject : item.key.subject
  const period =
    edit?.from !== undefined ? `${edit.from}–${edit.to}` : (periodOf({ ...item }) ?? t('anyPeriod'))
  // 采不来的给去 knowbase 直达上传；「不限主体」的没法说清要传哪一家，不给链接
  const uploadable = item.status === 'not_collectable' && Boolean(item.key.subject)
  const value = (each: { material_id: string; version_no: number }) =>
    `${each.material_id}@${each.version_no}`

  function pick(selected: string) {
    const found = pool.find((each) => value(each) === selected)
    const picks = { ...changes.picks }
    if (found) picks[item.ref] = { material_id: found.material_id, version_no: found.version_no }
    else delete picks[item.ref]
    onChange({ ...changes, picks })
  }

  return (
    <li className={cn('rounded-lg border p-2', off && 'opacity-60')}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{shown?.name ?? item.need_key}</span>
        <span className="text-muted-foreground text-xs">
          {[subject ?? t('anySubject'), period, need?.required ? t('essential') : '']
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="text-muted-foreground ml-auto text-xs">
          {off ? t('dropped') : edit ? t('changed') : t(`status.${item.status}`)}
        </span>
      </div>
      {shown?.source_query ? (
        <details className="mt-2 text-xs" open>
          <summary>
            {t('supplierQuery')} · {shown.source_query.channel} · {shown.source_query.tool}
          </summary>
          <pre className="mt-1 break-all whitespace-pre-wrap">
            {JSON.stringify(shown.source_query.arguments, null, 2)}
          </pre>
          <p>{t('supplierEvidence')}</p>
        </details>
      ) : null}
      {!off && !edit && pool.length > 1 ? (
        <select
          aria-label={t('pick', { name: shown?.name ?? item.need_key })}
          className={cn(field, 'mt-1.5 w-full')}
          value={changes.picks[item.ref] ? value(changes.picks[item.ref]) : ''}
          onChange={(event) => pick(event.target.value)}
        >
          <option value="">{item.status === 'ambiguous' ? t('choose') : t('asListed')}</option>
          {pool.map((each) => (
            <option key={value(each)} value={value(each)}>
              {t('candidate', { name: each.name || each.material_id, version: each.version_no })}
            </option>
          ))}
        </select>
      ) : !off && !edit && chosen.length ? (
        <p className="text-muted-foreground mt-1 truncate">
          {chosen.map((each) => each.name || each.material_id).join(' · ')}
        </p>
      ) : null}
      {!off && !edit && item.status === 'to_confirm' && item.prematch ? (
        <PrematchLine prematch={item.prematch} />
      ) : null}
      {!off && !edit && uploadable ? (
        <CrossAppLink
          to="knowbase.upload"
          values={uploadValues(item)}
          refValue={task}
          className="mt-1 inline-block text-xs underline underline-offset-3"
        >
          {t('upload')}
        </CrossAppLink>
      ) : null}
      {!off && !edit && uploadable ? (
        <button
          type="button"
          className="text-muted-foreground ml-3 text-xs underline underline-offset-3"
          disabled={rechecking}
          onClick={onRecheck}
        >
          {rechecking ? t('rechecking') : t('recheck')}
        </button>
      ) : null}
      {editing && need ? (
        <EditItem
          need={shown ?? need}
          subject={subject ?? null}
          onDone={(next) => {
            setEditing(false)
            if (next) onChange({ ...changes, edits: { ...changes.edits, [need.key]: next } })
          }}
        />
      ) : null}
      <div className="mt-1 flex gap-3 text-xs">
        <button
          type="button"
          className="text-muted-foreground underline underline-offset-3"
          onClick={() =>
            onChange({
              ...changes,
              dropped: off
                ? changes.dropped.filter((each) => each !== item.ref)
                : [...changes.dropped, item.ref],
            })
          }
        >
          {off ? t('undrop') : t('drop')}
        </button>
        {!off && need && !editing ? (
          <button
            type="button"
            className="text-muted-foreground underline underline-offset-3"
            onClick={() => setEditing(true)}
          >
            {t('edit')}
          </button>
        ) : null}
      </div>
    </li>
  )
}

function YearRange({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string
  to: string
  onFrom: (value: string) => void
  onTo: (value: string) => void
}) {
  const t = useTranslations('expert.data')
  return (
    <>
      <Input
        aria-label={t('from')}
        className="h-8 w-20"
        inputMode="numeric"
        value={from}
        onChange={(event) => onFrom(event.target.value)}
      />
      <span>–</span>
      <Input
        aria-label={t('to')}
        className="h-8 w-20"
        inputMode="numeric"
        value={to}
        onChange={(event) => onTo(event.target.value)}
      />
    </>
  )
}

const year = (text: string) => {
  const n = Number(text)
  return Number.isInteger(n) && n >= 1990 && n <= THIS_YEAR + 1 ? n : null
}

function EditItem(props: {
  need: DataRequest
  subject: string | null
  onDone: (edit: Edit | null) => void
}) {
  return props.need.source_query ? (
    <EditSupplierQuery {...props} />
  ) : (
    <EditOrdinaryItem {...props} />
  )
}

function EditSupplierQuery({
  need,
  onDone,
}: {
  need: DataRequest
  onDone: (edit: Edit | null) => void
}) {
  const t = useTranslations('expert.data')
  const [value, setValue] = useState(JSON.stringify(need.source_query?.arguments, null, 2))
  let args: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      args = parsed as Record<string, unknown>
  } catch {
    /* Keep invalid input for correction. */
  }
  return (
    <div className="mt-2 space-y-2">
      <textarea
        className="w-full rounded border p-2 text-xs"
        rows={6}
        aria-label={t('supplierQuery')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-invalid={!args}
      />
      <Button
        size="sm"
        disabled={!args || !need.source_query}
        onClick={() => {
          if (args && need.source_query)
            onDone({ source_query: { ...need.source_query, arguments: args } })
        }}
      >
        {t('editDone')}
      </Button>
      <button type="button" onClick={() => onDone(null)}>
        {t('editCancel')}
      </button>
    </div>
  )
}

function EditOrdinaryItem({
  need,
  subject,
  onDone,
}: {
  need: DataRequest
  subject: string | null
  onDone: (edit: Edit | null) => void
}) {
  const t = useTranslations('expert.data')
  const [code, setCode] = useState(subject ?? '')
  const [from, setFrom] = useState(need.period.start?.slice(0, 4) ?? '')
  const [to, setTo] = useState(need.period.end?.slice(0, 4) ?? '')
  const normal = normalSubject(code)
  const badCode = normal !== null && !SUBJECT.test(normal)
  const years = from || to ? [year(from), year(to)] : null
  const badYears = years !== null && (years[0] === null || years[1] === null)
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <Input
        aria-label={t('subject')}
        placeholder={t('subjectHint')}
        className="h-8 w-40"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        aria-invalid={badCode || undefined}
      />
      <YearRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <Button
        size="sm"
        variant="outline"
        disabled={badCode || badYears}
        onClick={() =>
          onDone({
            subject: normal,
            ...(years && years[0] !== null && years[1] !== null
              ? { from: years[0], to: years[1] }
              : {}),
          })
        }
      >
        {t('editDone')}
      </Button>
      <button
        type="button"
        className="text-muted-foreground text-xs underline underline-offset-3"
        onClick={() => onDone(null)}
      >
        {t('editCancel')}
      </button>
    </div>
  )
}

function AddItem({
  onAdd,
}: {
  onAdd: (add: { doc_type: string; subject: string | null; from: number; to: number }) => void
}) {
  const t = useTranslations('expert.data')
  const [open, setOpen] = useState(false)
  const [docType, setDocType] = useState<string>(ADDABLE[0])
  const [code, setCode] = useState('')
  const [from, setFrom] = useState(String(THIS_YEAR - 1))
  const [to, setTo] = useState(String(THIS_YEAR - 1))
  const normal = normalSubject(code)
  const badCode = normal !== null && !SUBJECT.test(normal)
  const [a, b] = [year(from), year(to)]
  if (!open) {
    return (
      <button
        type="button"
        className="text-muted-foreground text-xs underline underline-offset-3"
        onClick={() => setOpen(true)}
      >
        {t('add')}
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="task-data-add">
      <select
        aria-label={t('docTypeLabel')}
        className={field}
        value={docType}
        onChange={(event) => setDocType(event.target.value)}
      >
        {ADDABLE.map((each) => (
          <option key={each} value={each}>
            {t(`docType.${each}`)}
          </option>
        ))}
      </select>
      <Input
        aria-label={t('subject')}
        placeholder={t('subjectHint')}
        className="h-8 w-40"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        aria-invalid={badCode || undefined}
      />
      <YearRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <Button
        size="sm"
        variant="outline"
        disabled={badCode || a === null || b === null}
        onClick={() => {
          if (a === null || b === null) return
          onAdd({ doc_type: docType, subject: normal, from: a, to: b })
          setOpen(false)
          setCode('')
        }}
      >
        {t('addDone')}
      </Button>
    </div>
  )
}

function SupplyProgress({ data }: { data: TaskData }) {
  const format = useFormatter()
  const t = useTranslations('expert.data')
  const snapshot = data.supply_progress
  const items = snapshot?.items ?? []
  const counts = { ready: 0, open: 0, partial: 0, failed: 0 }
  const groups = new Map<
    string,
    {
      subject: string
      doc: string
      readings: string[]
      rows: Map<string, { status: string; reason: string | null; periods: string[] }>
    }
  >()
  for (const item of items) {
    if (item.status === 'ready') counts.ready++
    else if (['accepted', 'fetching'].includes(item.status)) counts.open++
    else if (item.status === 'partial') counts.partial++
    else counts.failed++
    const subject = item.key?.subject ?? t('anySubject')
    const doc = item.key?.doc_type ?? 'unknown'
    const groupKey = JSON.stringify([subject, doc, item.readings])
    const group = groups.get(groupKey) ?? { subject, doc, readings: item.readings, rows: new Map() }
    const rowKey = JSON.stringify([item.status, item.reason])
    const row = group.rows.get(rowKey) ?? { status: item.status, reason: item.reason, periods: [] }
    const period = [item.key?.period_start, item.key?.period_end].filter(Boolean).join('–')
    if (period && !row.periods.includes(period)) row.periods.push(period)
    group.rows.set(rowKey, row)
    groups.set(groupKey, group)
  }
  return (
    <div className="space-y-2" data-testid="supply-progress">
      <p className="font-medium">{t('progress.title')}</p>
      {items.length ? (
        <>
          <p>{t('progress.counts', { total: items.length, ...counts })}</p>
          <p className="text-muted-foreground">
            {t(counts.failed || counts.partial ? 'progress.hasFailures' : 'progress.continue')}
          </p>
          <p className="text-muted-foreground text-xs">
            {t('progress.checkedAt', {
              time: format.dateTime(new Date(snapshot!.checked_at), {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
            })}
          </p>
          <ul className="space-y-1.5">
            {[...groups.entries()].map(([key, group]) => (
              <li key={key} className="rounded border px-2 py-1">
                <span className="font-medium">
                  {group.subject} ·{' '}
                  {t.has(`docType.${group.doc}`) ? t(`docType.${group.doc}`) : group.doc}
                </span>
                <span className="text-muted-foreground ml-2">
                  {group.readings
                    .map((r) => (t.has(`progress.reading.${r}`) ? t(`progress.reading.${r}`) : r))
                    .join('、')}
                </span>
                {[...group.rows.entries()].map(([key, row]) => (
                  <p key={key} className="text-xs leading-5">
                    {t.has(`progress.status.${row.status}`)
                      ? t(`progress.status.${row.status}`)
                      : row.status}
                    ：{row.periods.sort().join('、')}
                    {row.reason
                      ? ` · ${t.has(`progress.reason.${row.reason}`) ? t(`progress.reason.${row.reason}`) : row.reason}`
                      : ''}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-muted-foreground">
          {t('progress.awaitingStatus', { count: data.waiting_for.length })}
        </p>
      )}
    </div>
  )
}
