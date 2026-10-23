// 云端知识库的规则与算法：不取数、不渲染（SDD 0042）。

// 与 knowbase 收的一致：PDF、Excel、CSV、文本、Markdown，单份 50 MB
export const ACCEPT = '.pdf,.xlsx,.xls,.csv,.txt,.md'
export const MAX_BYTES = 50 * 1024 * 1024

export function sizeText(bytes: number | null): string | null {
  if (bytes === null) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// 后端（knowbase）回的 code → 页面上的说法；没列的一律「没有成功」
const SAID = {
  in_use: 'inUse',
  type_not_allowed: 'typeNotAllowed',
  content_mismatch: 'contentMismatch',
  not_utf8: 'notUtf8',
  too_large: 'tooLarge',
  quota_exceeded: 'quotaExceeded',
  empty: 'emptyFile',
  item_not_found: 'gone',
  reauth_required: 'reauth',
  knowbase_unconfigured: 'unavailable',
  knowbase_unavailable: 'unavailable',
} as const

export type Said = (typeof SAID)[keyof typeof SAID] | 'failed'

export function said(code: string | undefined): Said {
  return (code && SAID[code as keyof typeof SAID]) || 'failed'
}
