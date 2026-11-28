// 完成与否只看后端记下来的电脑，不让用户自己勾「我已下载」。
import type { Machine } from '@/contracts/workbench-v2'

export type GuideProgress = {
  install: boolean
  connect: boolean
  folders: boolean
}

export function progress(machines: Machine[] | undefined): GuideProgress {
  const list = machines ?? []
  return {
    install: list.length > 0,
    connect: list.some(isOnline),
    folders: list.some((machine) => machine.roots.length > 0),
  }
}

export function isOnline(machine: Machine) {
  return machine.status === 'online'
}
