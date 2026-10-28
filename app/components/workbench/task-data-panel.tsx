'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DataRequest, ListedItem, TaskData } from '@/contracts/workbench-v2'
import { WorkbenchError } from '@/lib/workbench/http'
import {
  type Changes,
  chosenOf,
  confirmBody,
  edited,
  noChanges,
  normalSubject,
  periodOf,
  SUBJECT,
  unchosen,
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
  if (!data.listed) return null
  const request = data.requests.find((each) => each.status === 'pending')
  const missing = data.requests.filter((each) => each.status === 'missing')
  const busy = act.confirm.isPending || act.decline.isPending
  const failure = (act.confirm.error ?? act.decline.error) as WorkbenchError | null
  const blocked = request ? unchosen(request, changes).length : 0

  return (
    <section
      aria-label={t('title')}
      className={cn('space-y-1.5 text-[13px]', !compact && 'shrink-0 border-b px-4 py-2')}
      data-testid="task-data"
    >
      {data.status === 'planning' ? <p className="text-muted-foreground">{t('planning')}</p> : null}
      {data.status === 'waiting' ? (
        <p className="text-amber-700 dark:text-amber-400">
          {data.waiting_for.length
            ? t('waiting', { items: data.waiting_for.join('、') })
            : t('waitingPlain')}
          {data.demand_status ? (
            <span className="text-muted-foreground ml-2">
              {t('demand', { status: data.demand_status })}
            </span>
          ) : null}
        </p>
      ) : null}

      {request && data.confirm_in === 'knowlab' ? (
        <p className="text-amber-700 dark:text-amber-400" data-testid="task-data-elsewhere">
          {t('confirmInKnowlab', { items: request.labels.join('、') })}
        </p>
      ) : request ? (
        <div className="space-y-1.5" data-testid="task-data-request">
          <p className="text-amber-700 dark:text-amber-400">{t('requested')}</p>
          <ul className="space-y-1.5">
            {request.items.map((item) => (
              <ItemRow
                key={item.ref}
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
          <p className="text-amber-700 dark:text-amber-400">
            {t('missing', { items: missing.flatMap((each) => each.missing).join('；') })}
          </p>
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

function ItemRow({
  item,
  need,
  changes,
  onChange,
}: {
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
      {editing && need ? (
        <EditItem
          need={need}
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

function EditItem({
  need,
  subject,
  onDone,
}: {
  need: DataRequest
  subject: string | null
  onDone: (edit: { subject?: string | null; from?: number; to?: number } | null) => void
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
