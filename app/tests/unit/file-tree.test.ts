import { describe, expect, it } from 'vitest'

import {
  childPath,
  decodeText,
  isUnder,
  pathsToExpand,
  separatorOf,
  sortEntries,
  treeRoots,
} from '@/lib/workbench/file-tree'

describe('文件树的路径算术（Windows 与 POSIX 都认）', () => {
  it('分隔符看根长什么样', () => {
    expect(separatorOf('C:\\Users\\me')).toBe('\\')
    expect(separatorOf('\\\\server\\share')).toBe('\\')
    expect(separatorOf('/home/me')).toBe('/')
    expect(childPath('C:\\r', '恒瑞医药')).toBe('C:\\r\\恒瑞医药')
    expect(childPath('C:\\', 'a')).toBe('C:\\a')
    expect(childPath('/home/me/', 'a')).toBe('/home/me/a')
  })

  it('在不在某个根下面：不分大小写，不被同前缀的别的目录骗', () => {
    expect(isUnder('C:\\r\\p', 'c:\\R')).toBe(true)
    expect(isUnder('C:\\research2\\p', 'C:\\research')).toBe(false)
    expect(isUnder('/home/me', '/home/me')).toBe(true)
  })

  it('树根：白名单目录；当前项目所在的根排最前', () => {
    const info = { roots: ['D:\\notes', 'C:\\r'] }
    expect(treeRoots(info, 'C:\\r\\恒瑞医药').map((r) => r.path)).toEqual(['C:\\r', 'D:\\notes'])
    expect(treeRoots({ roots: [] }, null)).toEqual([])
  })

  it('从根到项目目录要展开的每一级', () => {
    expect(pathsToExpand('C:\\r', 'C:\\r\\a\\b')).toEqual(['C:\\r\\a', 'C:\\r\\a\\b'])
    expect(pathsToExpand('/home/me/', '/home/me/x')).toEqual(['/home/me/x'])
    expect(pathsToExpand('C:\\r', 'D:\\other')).toEqual([])
    expect(pathsToExpand('C:\\r', null)).toEqual([])
  })

  it('排序：目录先，重目录（.git、node_modules）垫底', () => {
    const sorted = sortEntries([
      { name: 'z.md', type: 'file' },
      { name: 'node_modules', type: 'dir' },
      { name: 'b', type: 'dir' },
      { name: 'a.md', type: 'file' },
      { name: '.git', type: 'dir' },
    ]).map((e) => e.name)
    expect(sorted).toEqual(['b', 'a.md', 'z.md', '.git', 'node_modules'])
  })

  it('内容：前 8 KiB 有 NUL 当二进制，否则按 UTF-8 解', () => {
    const bytes = (text: string) => new TextEncoder().encode(text)
    expect(decodeText(bytes('hello'))).toEqual({ text: 'hello' })
    expect(decodeText(new Uint8Array([97, 0, 98]))).toEqual({ binary: true })
    expect(decodeText(bytes('中文'))).toEqual({ text: '中文' })
  })
})
