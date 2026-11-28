// 前端的结构规矩（所有者 2026-10-04 定）：按功能分，功能里取数、状态、渲染分开。
// 和后端的分层检查一样，规矩写成测试，坏了就红。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()

function filesUnder(directory: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(join(root, directory))) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(directory, name)
    if (statSync(join(root, path)).isDirectory()) found.push(...filesUnder(path))
    else if (/\.(ts|tsx)$/.test(name)) found.push(path)
  }
  return found
}

function projectImport(file: string, target: string): string {
  if (!target.startsWith('.') && !target.startsWith('@/')) return target
  const path = target.startsWith('@/') ? resolve(root, target.slice(2)) : resolve(root, dirname(file), target)
  return '@/' + relative(root, path).split(sep).join('/')
}

function importsOf(file: string): string[] {
  const source = readFileSync(join(root, file), 'utf8')
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((found) => projectImport(file, found[1]))
}

const features = readdirSync(join(root, 'features')).filter((name) =>
  statSync(join(root, 'features', name)).isDirectory(),
)
const featureFiles = filesUnder('features')
const partOf = (file: string) => file.split(sep)[2] // features/<功能>/<api|model|ui>/…

describe('功能之间不互相引用', () => {
  it.each(features)('%s 不引用别的功能', (feature) => {
    const bad = featureFiles
      .filter((file) => file.startsWith(join('features', feature) + sep))
      .flatMap((file) =>
        importsOf(file)
          .filter((target) => target.startsWith('@/features/'))
          .filter((target) => target.split('/')[2] !== feature)
          .map((target) => `${file} → ${target}`),
      )
    expect(bad).toEqual([])
  })

  it('公共的部分（lib、components、contracts）不引用功能', () => {
    const bad = ['lib', 'components', 'contracts'].flatMap(filesUnder).flatMap((file) =>
      importsOf(file)
        .filter((target) => target.startsWith('@/features/'))
        .map((target) => `${file} → ${target}`),
    )
    expect(bad).toEqual([])
  })

  it('页面只从功能的出口拿东西，不伸手到里面', () => {
    const bad = filesUnder('app').flatMap((file) =>
      importsOf(file)
        .filter((target) => /^@\/features\/[^/]+\/.+/.test(target))
        .map((target) => `${file} → ${target}`),
    )
    expect(bad).toEqual([])
  })
})

describe('一个功能里：取数、状态、渲染分开', () => {
  it('每个功能只有 api、model、ui 三个目录和一个出口', () => {
    for (const feature of features) {
      const inside = readdirSync(join(root, 'features', feature)).sort()
      expect(inside.filter((name) => !['api', 'model', 'ui', 'index.ts'].includes(name))).toEqual(
        [],
      )
      expect(inside).toContain('index.ts')
    }
  })

  it('状态（model）不取数、不渲染', () => {
    const bad = featureFiles
      .filter((file) => partOf(file) === 'model')
      .flatMap((file) => {
        const source = readFileSync(join(root, file), 'utf8')
        const reasons = importsOf(file)
          .filter(
            (target) =>
              /^@\/features\/[^/]+\/(api|ui)\b/.test(target) ||
              target === '@tanstack/react-query' ||
              target === '@/lib/workbench/http' ||
              target.startsWith('@/components/'),
          )
          .map((target) => `${file} → ${target}`)
        if (/\bfetch\(/.test(source)) reasons.push(`${file} 里有 fetch(`)
        if (file.endsWith('.tsx')) reasons.push(`${file} 是 .tsx`)
        return reasons
      })
    expect(bad).toEqual([])
  })

  it('取数（api）不渲染', () => {
    const bad = featureFiles
      .filter((file) => partOf(file) === 'api')
      .flatMap((file) => {
        const reasons = importsOf(file)
          .filter((target) => /^@\/features\/[^/]+\/ui\b/.test(target) || target.startsWith('@/components/'))
          .map((target) => `${file} → ${target}`)
        if (file.endsWith('.tsx')) reasons.push(`${file} 是 .tsx`)
        return reasons
      })
    expect(bad).toEqual([])
  })

  it('渲染（ui）不自己发请求：经过 api 或公共的取数', () => {
    const bad = featureFiles
      .filter((file) => partOf(file) === 'ui')
      .flatMap((file) => {
        const source = readFileSync(join(root, file), 'utf8')
        const reasons: string[] = []
        if (/\bfetch\(/.test(source)) reasons.push(`${file} 里有 fetch(`)
        if (/\b(getJson|sendJson)\b/.test(source)) reasons.push(`${file} 直接用了 getJson/sendJson`)
        return reasons
      })
    expect(bad).toEqual([])
  })

  it('这份检查真的看到了文件', () => {
    expect(features.length).toBeGreaterThanOrEqual(4)
    expect(featureFiles.map((file) => relative('features', file)).length).toBeGreaterThan(8)
  })
})

it('resolves sibling features for both relative and aliased imports', () => {
  const file = 'features/expert/ui/form.tsx'
  expect(projectImport(file, '../../home/ui/form')).toBe('@/features/home/ui/form')
  expect(projectImport(file, '@/features/home/ui/form')).toBe('@/features/home/ui/form')
})
