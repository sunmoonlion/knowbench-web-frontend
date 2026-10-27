'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DataPlan, ListedItem, ListedNeed } from '@/contracts/workbench-v2'
import { WorkbenchError } from '@/lib/workbench/http'
import { cn } from '@/lib/utils'

import { useDataPlan } from '../api/desk'
import {
  chosenOf,
  itemProblem,
  type ListedPicks,
  MAX_SUBJECTS,
  parseSubjects,
  periodOf,
  toFetch,
} from '../model/listed'

const label = 'text-muted-foreground mb-1.5 text-xs font-medium'
const field =
  'border-input h-8 w-full rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:border-ring'

export type Listed = { plan: DataPlan; picks: ListedPicks; dropped: string[] }

// 清单 v2 的专家（SDD 0043 第 3.5 节）：填主体 → 列出每一样用哪份、哪一版、为什么；
// 已定的默认直接用、可以换；有歧义的必须选；可选的可以不用；缺的随请专家一并确认，
// 交给数据服务去取，齐了委托自动接着跑（所有者 10-27 定）。
export function ListedData({
  expert,
  needs,
  bound,
  listed,
  onChange,
}: {
  expert: string
  needs: ListedNeed[]
  bound: number
  listed: Listed | null
  onChange: (next: Listed | null) => void
}) {
  const t = useTranslations('askExpert.listed')
  const list = useDataPlan()
  const [typed, setTyped] = useState('')
  const { subjects, bad } = parseSubjects(typed)
  const byKey = new Map(needs.map((need) => [need.key, need]))

  async function run() {
    if (!subjects.length || bad.length || subjects.length > MAX_SUBJECTS) return
    try {
      const plan = await list.mutateAsync({ expert, subjects })
      onChange({ plan, picks: {}, dropped: [] })
    } catch {
      onChange(null)
    }
  }

  const fetching = listed ? toFetch(listed.plan, listed.dropped) : []

  return (
    <section aria-label={t('title')}>
      <p className={label}>{t('title')}</p>
      <p className="text-muted-foreground mb-2 text-[13px]">
        {t('lead', { needs: needs.map((need) => need.name).join('、') })}
        {bound ? ` ${t('bound', { count: bound })}` : ''}
      </p>
      <div className="flex gap-2">
        <Input
          aria-label={t('subjects')}
          placeholder={t('subjectsHint')}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value)
            onChange(null)
          }}
          aria-invalid={bad.length > 0 || undefined}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!subjects.length || bad.length > 0 || list.isPending}
          onClick={() => void run()}
        >
          {list.isPending ? t('listing') : listed ? t('relist') : t('list')}
        </Button>
      </div>
      {bad.length ? (
        <p className="mt-1 text-[13px] text-amber-700 dark:text-amber-400">
          {t('badSubjects', { codes: bad.join('、') })}
        </p>
      ) : null}
      {list.isError ? (
        <p role="alert" className="text-destructive mt-1 text-[13px]">
          {t.has(`problem.${(list.error as WorkbenchError).code}`)
            ? t(`problem.${(list.error as WorkbenchError).code}`)
            : t('problem.other')}
        </p>
      ) : null}

      {listed ? (
        <ul className="mt-3 space-y-2" data-testid="listed-items">
          {listed.plan.resolution.items.map((item) => (
            <ListedRow
              key={item.ref}
              item={item}
              need={byKey.get(item.need_key)}
              listed={listed}
              onChange={onChange}
            />
          ))}
        </ul>
      ) : null}
      {fetching.length ? (
        <p className="text-muted-foreground mt-2 text-[13px]" data-testid="listed-fetch">
          {t('fetchNote', { count: fetching.length })}
        </p>
      ) : null}
    </section>
  )
}

function ListedRow({
  item,
  need,
  listed,
  onChange,
}: {
  item: ListedItem
  need: ListedNeed | undefined
  listed: Listed
  onChange: (next: Listed) => void
}) {
  const t = useTranslations('askExpert.listed')
  const { plan, picks, dropped } = listed
  const off = dropped.includes(item.ref)
  const problem = itemProblem(item, need, plan, picks, dropped)
  const chosen = chosenOf(item, picks)
  const pool = [...item.chosen, ...item.candidates]
  const optional = need?.required === false
  const period = periodOf(item)

  function pick(value: string) {
    const found = pool.find((each) => `${each.material_id}@${each.version_no}` === value)
    const next = { ...picks }
    if (found) next[item.ref] = { material_id: found.material_id, version_no: found.version_no }
    else delete next[item.ref]
    onChange({ ...listed, picks: next })
  }

  return (
    <li className={cn('rounded-lg border p-2.5 text-sm', off && 'opacity-60')}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{need?.name ?? item.need_key}</span>
        <span className="text-muted-foreground text-xs">
          {[item.key.subject, period, t(optional ? 'optional' : 'required')]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span
          className={cn(
            'ml-auto text-xs',
            problem && !off ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {off ? t('dropped') : t(`status.${item.status}`)}
        </span>
      </div>
      {!off && pool.length > 1 ? (
        <select
          aria-label={t('pick', { name: need?.name ?? item.need_key })}
          className={cn(field, 'mt-1.5')}
          value={
            picks[item.ref] ? `${picks[item.ref].material_id}@${picks[item.ref].version_no}` : ''
          }
          onChange={(event) => pick(event.target.value)}
        >
          <option value="">{item.status === 'ambiguous' ? t('choose') : t('asListed')}</option>
          {pool.map((each) => (
            <option
              key={`${each.material_id}@${each.version_no}`}
              value={`${each.material_id}@${each.version_no}`}
            >
              {t('candidate', { name: each.name || each.material_id, version: each.version_no })}
            </option>
          ))}
        </select>
      ) : !off && chosen.length ? (
        <p className="text-muted-foreground mt-1 truncate text-[13px]">
          {chosen.map((each) => each.name || each.material_id).join(' · ')}
        </p>
      ) : null}
      {problem && !off && problem !== 'choose' ? (
        <p className="mt-1 text-[13px] text-amber-700 dark:text-amber-400">
          {t(`problem.${problem}`)}
        </p>
      ) : null}
      {optional ? (
        <button
          type="button"
          className="text-muted-foreground mt-1 text-xs underline underline-offset-3"
          onClick={() =>
            onChange({
              ...listed,
              dropped: off ? dropped.filter((each) => each !== item.ref) : [...dropped, item.ref],
            })
          }
        >
          {off ? t('undrop') : t('drop')}
        </button>
      ) : null}
    </li>
  )
}
