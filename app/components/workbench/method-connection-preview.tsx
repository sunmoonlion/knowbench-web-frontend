import { useTranslations } from 'next-intl'
import type { FormalMethodCatalogItem } from '@/lib/workbench/formal-methods'

export function MethodConnectionPreview({
  preview,
}: {
  preview: FormalMethodCatalogItem['connection_preview']
}) {
  const t = useTranslations('capabilities')
  if (!preview || (preview.complete && !preview.services.length)) return null
  const services = new Map<string, { required: boolean; capabilities: string[] }>()
  for (const entry of preview.services) {
    const group = services.get(entry.url) ?? { required: false, capabilities: [] }
    group.required ||= entry.required
    group.capabilities.push(`${entry.capability_ref} (${entry.version})`)
    services.set(entry.url, group)
  }
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">{t('planConnections')}</p>
      <ul>
        {Array.from(services, ([url, service]) => (
          <li className="break-all" key={url}>
            {t(service.required ? 'requiredConnection' : 'conditionalConnection')} ·{' '}
            {service.capabilities.join(', ')} · {url}
          </li>
        ))}
      </ul>
      {!preview.complete && <p>{t('unresolvedConnections')}</p>}
    </div>
  )
}
