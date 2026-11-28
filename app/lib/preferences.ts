'use client'

import { create } from 'zustand'

import { usePaneWidths } from './pane-widths'
import { PREFERENCES_KEY } from './preferences-boot'

// 个人偏好（0021 §二之 1）：语言跟地址走；这里是外观、主题色、侧边栏。只存浏览器本地，不经后端。
export const APPEARANCES = ['system', 'light', 'dark'] as const
export const ACCENTS = ['ink', 'blue', 'green', 'orange'] as const
export const SIDEBAR_WIDTHS = ['narrow', 'normal', 'wide'] as const
export const EXPAND_LEVELS = ['computer', 'workspace', 'project'] as const

export type Preferences = {
  appearance: (typeof APPEARANCES)[number]
  accent: (typeof ACCENTS)[number]
  sidebar: (typeof SIDEBAR_WIDTHS)[number]
  // 侧边栏默认展开到哪一级：电脑（工作区都收着）/ 工作区（项目收着）/ 项目（对话都摊开）
  expand: (typeof EXPAND_LEVELS)[number]
}

export const DEFAULT_PREFERENCES: Preferences = {
  appearance: 'system',
  accent: 'ink',
  sidebar: 'normal',
  expand: 'workspace',
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

export function readPreferences(): Preferences {
  let raw: Record<string, unknown> = {}
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? '{}')
    if (stored && typeof stored === 'object' && !Array.isArray(stored))
      raw = stored as Record<string, unknown>
  } catch {
    raw = {}
  }
  return {
    appearance: pick(APPEARANCES, raw.appearance, DEFAULT_PREFERENCES.appearance),
    accent: pick(ACCENTS, raw.accent, DEFAULT_PREFERENCES.accent),
    sidebar: pick(SIDEBAR_WIDTHS, raw.sidebar, DEFAULT_PREFERENCES.sidebar),
    expand: pick(EXPAND_LEVELS, raw.expand, DEFAULT_PREFERENCES.expand),
  }
}

export function writePreferences(preferences: Preferences) {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // 存不了就只在这一次有效
  }
}

// 套到 <html> 上：.dark 给 Tailwind 的深色变体，data-accent / data-sidebar 给 globals.css 与侧边栏
export function applyPreferences(preferences: Preferences, root = document.documentElement) {
  const dark =
    preferences.appearance === 'dark' ||
    (preferences.appearance === 'system' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
  root.dataset.accent = preferences.accent
  root.dataset.sidebar = preferences.sidebar
}

type Store = {
  preferences: Preferences
  ready: boolean
  restore: () => void
  update: (patch: Partial<Preferences>) => void
}

export const usePreferences = create<Store>((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  ready: false,
  restore: () => {
    if (get().ready) return
    const preferences = readPreferences()
    applyPreferences(preferences)
    set({ preferences, ready: true })
  },
  update: (patch) => {
    // 在设置里选了侧边栏宽度，就不再用拖出来的宽度
    if (patch.sidebar) usePaneWidths.getState().set('sidebar', null)
    const preferences = { ...get().preferences, ...patch }
    writePreferences(preferences)
    applyPreferences(preferences)
    set({ preferences })
  },
}))
