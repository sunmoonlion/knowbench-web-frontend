'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { usePreferences } from '@/lib/preferences'

export function PlatformProviders({ children }: { children: React.ReactNode }) {
  const appearance = usePreferences((state) => state.preferences.appearance)
  const restore = usePreferences((state) => state.restore)
  useEffect(() => restore(), [restore])
  useEffect(() => {
    if (appearance !== 'system' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const refresh = () => document.documentElement.classList.toggle('dark', media.matches)
    if (usePreferences.getState().preferences.appearance === 'system') refresh()
    media.addEventListener('change', refresh)
    return () => media.removeEventListener('change', refresh)
  }, [appearance])
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  )
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
