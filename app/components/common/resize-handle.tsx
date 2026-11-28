'use client'

import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

// 分栏之间可拖的分割线（所有者 2026-10-17）。鼠标、触屏拖；键盘左右键每次 16px（按住 Shift 64px）；双击恢复默认。
// edge 是手柄在栏的哪一边：在右边（侧边栏）往右拖变宽，在左边（右栏）往左拖变宽。
export function ResizeHandle({
  edge,
  width,
  min,
  max,
  label,
  hint,
  onResize,
  onReset,
  className,
}: {
  edge: 'left' | 'right'
  width: number
  min: number
  max: number
  label: string
  hint?: string
  onResize: (width: number) => void
  onReset: () => void
  className?: string
}) {
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(null)
  const sign = edge === 'right' ? 1 : -1

  function clearDrag() {
    if (!drag.current) return
    drag.current = null
    document.documentElement.classList.remove('resizing-panes')
  }
  useEffect(() => clearDrag, [])
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || document.documentElement.classList.contains('resizing-panes')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { x: event.clientX, width, pointer: event.pointerId }
    document.documentElement.classList.add('resizing-panes')
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return
    onResize(drag.current.width + sign * (event.clientX - drag.current.x))
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return
    clearDrag()
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const outward = (event.key === 'ArrowRight') === (edge === 'right')
      onResize(width + (outward ? step : -step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onResize(min)
    } else if (event.key === 'End') {
      event.preventDefault()
      onResize(max)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onReset()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      title={hint}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        'group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none',
        edge === 'right' ? '-right-1' : '-left-1',
        className,
      )}
    >
      <span className="bg-primary/60 group-focus-visible:bg-primary mx-auto block h-full w-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>
  )
}
