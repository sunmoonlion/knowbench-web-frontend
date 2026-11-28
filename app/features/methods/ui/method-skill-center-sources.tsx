'use client'

import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CrossAppLink } from '@/components/common/cross-app-link'
import { RequestFailure } from '@/components/common/request-failure'
import { useWorkbench } from '@/lib/workbench/context'
import {
  listSources,
  loadSource,
  saveSource,
  withdrawSource,
  methodSkillCenterKey,
  type DirectSource,
  type SourceInput,
} from '@/lib/workbench/method-skill-center'

const maxSourceBytes = 256 * 1024
const sourceKey = [...methodSkillCenterKey, 'sources']
type Edit = SourceInput & { id: string; version: number }
function SourceDetail({
  source,
  latest,
  onEdit,
}: {
  source: DirectSource
  latest: boolean
  onEdit: (d: Edit) => void
}) {
  const t = useTranslations('directRegistry')
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  const withdraw = useMutation({
    mutationFn: () => withdrawSource(source, csrfToken),
    onSettled: () => client.invalidateQueries({ queryKey: methodSkillCenterKey }),
  })
  const query = useQuery({
    queryKey: [...sourceKey, source.source_id, source.version, source.digest],
    queryFn: () => loadSource(source),
  })
  if (query.isError)
    return <RequestFailure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <p>{t('loading')}</p>
  const { content } = query.data
  return (
    <div className="space-y-2">
      <p className="font-mono text-xs break-all">
        {source.source_id} · {source.digest}
      </p>
      <pre className="max-h-64 overflow-auto rounded border p-2 text-sm">{content}</pre>
      {latest && (
        <Button
          variant="outline"
          onClick={() =>
            onEdit({
              id: source.source_id,
              version: source.version + 1,
              kind: source.kind,
              name: source.name,
              content,
            })
          }
        >
          {t('revise')}
        </Button>
      )}
      {latest && (
        <Button
          variant="outline"
          disabled={withdraw.isPending}
          onClick={() => {
            if (window.confirm(t('withdrawConfirm', { name: source.name }))) withdraw.mutate()
          }}
        >
          {t('withdraw')}
        </Button>
      )}
      {withdraw.isError && <RequestFailure error={withdraw.error} />}
    </div>
  )
}

export function MethodSkillCenterSources() {
  const t = useTranslations('directRegistry')
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  const query = useQuery({ queryKey: sourceKey, queryFn: listSources })
  const [edit, setEdit] = useState<Edit | null>(null)
  const [selected, select] = useState('')
  const [fileError, setFileError] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)
  const action = useMutation({
    mutationFn: ({ id, version, kind, name, content }: Edit) =>
      saveSource(id, version, { kind, name, content }, csrfToken),
    onSuccess: async (row) => {
      setEdit(null)
      select(row.source_id + '/' + row.version)
      await client.invalidateQueries({ queryKey: sourceKey })
    },
  })
  const contentTooLarge =
    !!edit && new TextEncoder().encode(edit.content).byteLength > maxSourceBytes
  const canSave =
    !!edit &&
    !!edit.name.trim() &&
    !!edit.content.trim() &&
    !contentTooLarge &&
    !fileError &&
    !loadingFile &&
    !action.isPending
  function start(d: Edit) {
    action.reset()
    setFileError(false)
    setEdit(d)
  }
  const latest = new Map<string, number>()
  for (const row of query.data ?? [])
    latest.set(row.source_id, Math.max(latest.get(row.source_id) ?? 0, row.version))
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t('scope')}</p>
      {!edit && (
        <Button
          onClick={() =>
            start({ id: crypto.randomUUID(), version: 1, name: '', content: '', kind: 'script' })
          }
        >
          {t('create')}
        </Button>
      )}
      {edit && (
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave) action.mutate(edit)
          }}
        >
          <fieldset disabled={action.isPending || loadingFile} className="grid gap-3">
            <label>
              {t('kind')}{' '}
              <select
                disabled={edit.version > 1}
                value={edit.kind}
                onChange={(e) => setEdit({ ...edit, kind: e.target.value as Edit['kind'] })}
              >
                <option value="script">{t('script')}</option>
                <option value="instruction">{t('instruction')}</option>
              </select>
            </label>
            <label>
              {t('name')}{' '}
              <input
                required
                maxLength={200}
                className="rounded border p-1"
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label>
              {t('file')}{' '}
              <input
                type="file"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setLoadingFile(true)
                  try {
                    if (file.size > maxSourceBytes) throw new RangeError()
                    const content = new TextDecoder('utf-8', {
                      fatal: true,
                      ignoreBOM: true,
                    }).decode(await file.arrayBuffer())
                    setEdit({ ...edit, content, name: edit.name || file.name })
                    setFileError(false)
                  } catch {
                    setFileError(true)
                  } finally {
                    setLoadingFile(false)
                  }
                }}
              />
            </label>
            <label>
              {t('content')}{' '}
              <textarea
                required
                rows={9}
                className="block w-full rounded border p-2 font-mono"
                value={edit.content}
                onChange={(e) => {
                  setFileError(false)
                  setEdit({ ...edit, content: e.target.value })
                }}
              />
            </label>
            {(fileError || contentTooLarge) && <p role="alert">{t('fileError')}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={!canSave}>
                {t('save', { version: edit.version })}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEdit(null)}>
                {t('cancel')}
              </Button>
            </div>
          </fieldset>
          {action.isError && (
            <RequestFailure
              error={action.error}
              retry={canSave ? () => action.mutate(edit) : undefined}
            />
          )}
        </form>
      )}
      {query.isError ? (
        <RequestFailure error={query.error} retry={() => void query.refetch()} />
      ) : !query.data ? (
        <p>{t('loading')}</p>
      ) : query.data.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        query.data.map((row) => {
          const key = row.source_id + '/' + row.version
          return (
            <article key={key} className="space-y-2 rounded border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  className="text-left underline"
                  aria-expanded={key === selected}
                  onClick={() => select(key === selected ? '' : key)}
                >
                  {row.name} · v{row.version} · {t(row.kind)}
                </button>
                <CrossAppLink
                  to="knowlab.studioNew"
                  values={{
                    method_kind: 'tool',
                    source_kind: row.kind,
                    source_id: row.source_id,
                    source_version: String(row.version),
                    source_name: row.name,
                  }}
                  className="text-xs underline"
                >
                  {t('wrapInKnowLab')}
                </CrossAppLink>
              </div>
              {key === selected && (
                <SourceDetail
                  source={row}
                  latest={!edit && latest.get(row.source_id) === row.version}
                  onEdit={start}
                />
              )}
            </article>
          )
        })
      )}
    </div>
  )
}
