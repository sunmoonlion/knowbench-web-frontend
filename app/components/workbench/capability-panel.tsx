'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RequestFailure } from '@/components/common/request-failure'
import { useWorkbench } from '@/lib/workbench/context'
import { routes } from '@/lib/workbench/routes'
import * as api from '@/lib/workbench/capabilities'

export function CapabilityPanel({ sessionId }: { sessionId: string }) {
  const t = useTranslations('capabilities'),
    { locale } = useWorkbench()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const selection = useQuery({
    queryKey: ['capability-selection', sessionId],
    queryFn: () => api.selection(sessionId),
    enabled: open,
    refetchOnWindowFocus: true,
  })
  const calls = useQuery({
    queryKey: ['capability-calls', sessionId],
    queryFn: () => api.calls(sessionId),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  return (
    <section className="border-t px-4 py-2 text-sm">
      <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('thisRun')}{' '}
        {calls.data?.calls.some((c) => c.status === 'awaiting_approval')
          ? `· ${t('pendingApproval')}`
          : ''}
      </Button>
      {open ? (
        <div className="mx-auto mt-3 max-h-[60vh] max-w-3xl space-y-4 overflow-auto rounded-xl border p-4">
          <div className="flex flex-wrap gap-4">
            <Link
              className="underline"
              href={`${routes.settings(locale, 'connections')}?returnTo=${encodeURIComponent(pathname)}`}
            >
              {t('connections')}
            </Link>
            <Link
              className="underline"
              href={`${routes.settings(locale, 'skills')}?returnTo=${encodeURIComponent(pathname)}`}
            >
              {t('skills')}
            </Link>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void selection.refetch()
                void calls.refetch()
              }}
            >
              {t('reload')}
            </Button>
          </div>
          {selection.isError ? (
            <RequestFailure error={selection.error} retry={() => void selection.refetch()} />
          ) : selection.data ? (
            <SelectionForm key={selection.data.revision} value={selection.data} />
          ) : (
            <p>{t('loading')}</p>
          )}
          {calls.isError ? (
            <RequestFailure error={calls.error} retry={() => void calls.refetch()} />
          ) : (
            calls.data?.calls.map((call) => <ActionCard key={call.id} call={call} />)
          )}
        </div>
      ) : null}
    </section>
  )
}

function SelectionForm({ value }: { value: api.Selection }) {
  const t = useTranslations('capabilities'),
    { csrfToken } = useWorkbench(),
    client = useQueryClient()
  const [tools, setTools] = useState(value.tools),
    [skills, setSkills] = useState(value.skills),
    [purpose, setPurpose] = useState(value.purpose)
  const [skillMode, setSkillMode] = useState(value.skill_mode)
  const save = useMutation({
    mutationFn: () =>
      api.saveSelection(
        value.session_id,
        {
          revision: value.revision,
          tools,
          skills: skillMode === 'auto' ? [] : skills,
          purpose,
          skill_mode: skillMode,
        },
        csrfToken,
      ),
    onSuccess: async (result) => {
      client.setQueryData(['capability-selection', value.session_id], result)
    },
  })
  const toggle = (items: string[], key: string, on: boolean) =>
    on ? [...items, key] : items.filter((x) => x !== key)
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <p className="text-muted-foreground">{t('selectionHint')}</p>
      {!value.editable ? <p role="status">{t('methodFrozen')}</p> : null}
      {value.method ? (
        <div className="space-y-2 rounded border p-3">
          <p>
            {value.method.profile_id} · {value.method.step_id ?? t('notStarted')}
          </p>
          <p>
            {t('declaredTools')}：{value.method.declared_tools.join(', ') || t('noneDeclared')}
          </p>
          <p>{t('methodManagedUnavailable')}</p>
        </div>
      ) : null}
      <p>
        {t('preparation')}：
        {t.has(`state.${value.preparation}`) ? t(`state.${value.preparation}`) : value.preparation}{' '}
        · {t('revision', { revision: value.revision })}
      </p>
      {value.issues.length ? (
        <ul role="alert" className="space-y-1 text-amber-700">
          {value.issues.map((issue, i) => (
            <li key={i}>{t.has(`issue.${issue.code}`) ? t(`issue.${issue.code}`) : issue.code}</li>
          ))}
        </ul>
      ) : null}
      <fieldset disabled={!value.editable || save.isPending} className="space-y-2">
        <legend className="font-medium">{t('connections')}</legend>
        {(value.method ? [] : value.available_tools).map((tool) => (
          <label key={tool.key} className="flex items-start gap-2 rounded border p-2">
            <input
              type="checkbox"
              checked={tools.includes(tool.key)}
              disabled={tool.status !== 'active' && !tools.includes(tool.key)}
              onChange={(e) => setTools(toggle(tools, tool.key, e.target.checked))}
            />
            <span>
              {tool.name}
              <small className="text-muted-foreground block">
                {tool.connection_name} · {tool.account_label}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset disabled={!value.editable || save.isPending} className="space-y-2">
        <legend className="font-medium">{t('skills')}</legend>
        <label className="block">
          {t('skillScope')}
          <select
            className="mt-1 w-full rounded border px-3 py-2"
            value={skillMode}
            onChange={(e) => setSkillMode(e.target.value as 'auto' | 'explicit')}
          >
            <option value="auto">{t('skillAuto')}</option>
            <option value="explicit">{t('skillExplicit')}</option>
          </select>
        </label>
        <p className="text-muted-foreground">{t('skillDiscoveryHint')}</p>
        {(value.method ? [] : value.available_skills).map((skill) => (
          <label key={skill.id} className="flex items-start gap-2 rounded border p-2">
            <input
              type="checkbox"
              checked={skillMode === 'auto' ? skill.status === 'active' : skills.includes(skill.id)}
              disabled={
                skillMode === 'auto' || (skill.status !== 'active' && !skills.includes(skill.id))
              }
              onChange={(e) => setSkills(toggle(skills, skill.id, e.target.checked))}
            />
            <span>
              {skill.name} · {skill.detail.version}
              <small className="text-muted-foreground block">{skill.detail.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {!value.available_tools.length && !value.available_skills.length ? <p>{t('empty')}</p> : null}
      <label className="block">
        {t('purpose')}
        <input
          className="mt-1 w-full rounded border px-3 py-2"
          maxLength={1000}
          disabled={!value.editable}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
      </label>
      {save.isError ? (
        <RequestFailure
          error={save.error}
          retry={() =>
            void client.invalidateQueries({ queryKey: ['capability-selection', value.session_id] })
          }
        />
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={!value.editable || save.isPending}
        onClick={() => {
          setTools([])
          setSkills([])
          setSkillMode('explicit')
        }}
      >
        {t('clearSelection')}
      </Button>{' '}
      <Button type="submit" disabled={!value.editable || save.isPending}>
        {t(save.isPending ? 'saving' : 'saveSelection')}
      </Button>
    </form>
  )
}

function ActionCard({ call }: { call: api.CapabilityCall }) {
  const t = useTranslations('capabilities'),
    { csrfToken } = useWorkbench(),
    client = useQueryClient()
  const decision = useMutation({
    mutationFn: (answer: 'accept' | 'decline') => api.decide(call, answer, csrfToken),
    onSuccess: () => client.invalidateQueries({ queryKey: ['capability-calls', call.session_id] }),
  })
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <h4 className="font-medium">
        {call.detail.tool.name} ·{' '}
        {t.has(`state.${call.status}`) ? t(`state.${call.status}`) : call.status}
      </h4>
      <p>
        {call.detail.connection_name} · {call.detail.account_label}
      </p>
      {call.detail.purpose ? (
        <p>
          {t('purpose')}：{call.detail.purpose}
        </p>
      ) : null}
      <p>{t('actionHint')}</p>
      <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
        {JSON.stringify(call.detail.arguments, null, 2)}
      </pre>
      {call.status === 'awaiting_approval' ? (
        <div className="flex gap-2">
          <Button disabled={decision.isPending} onClick={() => decision.mutate('accept')}>
            {t('allowOnce')}
          </Button>
          <Button
            variant="outline"
            disabled={decision.isPending}
            onClick={() => decision.mutate('decline')}
          >
            {t('decline')}
          </Button>
        </div>
      ) : null}
      {call.status === 'unknown' || call.status === 'dispatching' ? (
        <p role="status">{t('unknownOutcome')}</p>
      ) : null}
      {call.detail.result !== undefined ? (
        <details>
          <summary>{t('result')}</summary>
          <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap">
            {JSON.stringify(call.detail.result, null, 2)}
          </pre>
        </details>
      ) : null}
      {decision.isError ? (
        <RequestFailure
          error={decision.error}
          retry={() =>
            void client.invalidateQueries({ queryKey: ['capability-calls', call.session_id] })
          }
        />
      ) : null}
    </section>
  )
}
