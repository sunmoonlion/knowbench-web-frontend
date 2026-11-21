import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import samples from '../fixtures/capabilities-v1.samples.json'

test('runtime health endpoint is dynamic and non-cacheable', async ({ request }) => {
  const response = await request.get('/healthz')

  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toContain('no-store')
  expect(response.headers()['x-deployment-id']).toBe('arch-v2-r2-web-e2e')
  expect(await response.json()).toMatchObject({
    status: 'ok',
    surface: 'web',
    deployment_id: 'arch-v2-r2-web-e2e',
  })
})

test('public route is rendered and indexable', async ({ page }) => {
  const response = await page.goto('/en')

  expect(response?.status()).toBe(200)
  await expect(
    page.getByRole('heading', {
      name: 'A dependable foundation for product web applications',
    }),
  ).toBeVisible()
  await expect(page.locator('[data-route-class="public-content"]')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
})

test('anonymous workspace request is redirected by the SSR authorization boundary', async ({
  page,
}) => {
  // Stop at the provider entry: this test covers the real SSR redirect chain,
  // without depending on an external identity provider or its login state.
  await page.route('**/api/auth/web/login?**', (route) =>
    route.fulfill({ contentType: 'text/plain', body: 'SSO authorization started' }),
  )
  await page.goto('/en/dashboard')

  await expect(page).toHaveURL(/\/api\/auth\/web\/login\?return_to=%2Fen%2Fdashboard$/)
  await expect(page.getByText('SSO authorization started')).toBeVisible()
  await expect(page.locator('[data-route-class="login"]')).toHaveCount(0)
})

test('workspace route renders only after the paired backend validates its opaque session', async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: 'sunmoonai_knowbench_web_sid',
      value: 'e2e-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  const response = await page.goto('/en/dashboard')

  expect(response?.status()).toBe(200)
  expect(response?.headers()['cache-control']).toContain('no-store')
  await expect(page.locator('[data-route-class="authenticated-workspace"]')).toBeVisible()
  await expect(page.getByText('Signed in as Paired E2E User')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('paired run API streams evidence and accepts the authenticated confirmation', async ({
  context,
  baseURL,
  request,
}) => {
  await context.addCookies([
    {
      name: 'sunmoonai_knowbench_web_sid',
      value: 'e2e-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  const api = context.request
  const me = await api.get('/api/auth/web/me')
  const headers = { Origin: baseURL!, 'X-CSRF-Token': (await me.json()).csrf_token }
  const created = await api.post('/api/web/v1/runs', {
    headers,
    data: {
      contract_version: 1,
      idempotency_key: crypto.randomUUID(),
      title: null,
      input: { text: 'Use the authorized evidence' },
    },
  })
  expect(created.ok()).toBe(true)
  const path = `/api/web/v1/runs/${(await created.json()).run_id}`
  const stream = await api.get(`${path}/events`)
  expect(stream.headers()['content-type']).toContain('text/event-stream')
  const events = (await stream.text())
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
  expect(events.map((event) => event.type)).toEqual(['delta', 'citation', 'input_required'])
  expect(events[0].data.text.trim()).toBe('A streamed FastAPI response fragment.')
  const citation = events[1].data.citation
  expect(citation.title).toBe('FastAPI authorized reference')
  expect((await request.get(citation.source_href, { maxRedirects: 0 })).status()).toBe(401)
  const authorized = await api.get(citation.source_href, { maxRedirects: 0 })
  expect(authorized.status()).toBe(302)
  expect(authorized.headers().location).toContain('/api/web/v1/reference/sources/')
  const completed = await api.post(`${path}/actions`, {
    headers,
    data: { contract_version: 1, action_id: events[2].data.action.action_id, value: 'confirm' },
  })
  expect(completed.ok()).toBe(true)
  expect(await completed.json()).toMatchObject({ status: 'succeeded', required_action: null })
})

test('unknown route renders a not-found boundary', async ({ page }) => {
  const response = await page.goto('/en/route-that-does-not-exist')

  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('sitemap uses the runtime application origin', async ({ request, baseURL }) => {
  const response = await request.get('/sitemap.xml')

  expect(response.status()).toBe(200)
  expect(await response.text()).toContain(`${baseURL}/en`)
})

test('connection settings redirect the browser for the selected account revision', async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: 'sunmoonai_knowbench_web_sid',
      value: 'e2e-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  const provider = 'https://login.example.test/authorize?state=fixture'
  const asset = {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'connection',
    name: 'Agent workspace',
    revision: 2,
    status: 'reauth_required',
    default_selected: false,
    created_at: '2026-11-19T12:00:00Z',
    updated_at: '2026-11-20T12:00:00Z',
    detail: {
      url: 'https://agent.example.test/rpc',
      account_label: 'Office (external-one)',
      auth: 'oauth',
      oauth: {
        provider_id: 'agent',
        protocol: 'a2a',
        issuer: 'https://login.example.test',
        account_id: 'external-one',
        scopes: ['task.read'],
      },
      tools: [],
      checked_at: '2026-11-19T12:00:00Z',
    },
  }
  await page.route('**/api/workbench/capabilities', (route) =>
    route.fulfill({
      json: {
        assets: [asset],
        services: [
          {
            url: asset.detail.url,
            authentication: ['oauth'],
            provider_id: 'agent',
            protocol: 'a2a',
          },
        ],
        skill_formats: [],
        runtime_enabled: true,
      },
    }),
  )
  await page.route('**/api/workbench/capabilities/oauth/start', (route) =>
    route.fulfill({ json: { authorization_url: provider } }),
  )
  await page.route('https://login.example.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Test account service</title>' }),
  )
  const returnTo = '/en/workbench/chat/22222222-2222-4222-8222-222222222222'
  await page.goto('/en/workbench/settings/connections?returnTo=' + encodeURIComponent(returnTo))
  await expect(page.getByText('Reauthorization required', { exact: true })).toBeVisible()
  const started = page.waitForRequest('**/api/workbench/capabilities/oauth/start')
  await page.getByRole('button', { name: 'Reauthorize account' }).click()
  expect((await started).postDataJSON()).toEqual({
    provider_id: 'agent',
    name: asset.name,
    locale: 'en',
    return_to: returnTo,
    connection_id: asset.id,
    revision: asset.revision,
  })
  await expect(page).toHaveURL(provider)
})

test('chat approves a named resource scope and revokes the same receipt', async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: 'sunmoonai_knowbench_web_sid',
      value: 'e2e-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  const call = {
    ...samples.Call,
    detail: {
      ...samples.Call.detail,
      tool: { ...samples.Call.detail.tool, name: 'read_status' },
      arguments: { id: 'task-7' },
      purpose: 'Check delivery',
      approval: {
        effect: 'read',
        operation: 'status',
        destination: 'https://tools.example.test/mcp',
        resources: [{ resource_kind: 'connector', resource_role: 'task', values: ['task-7'] }],
        arguments_digest: 'b'.repeat(64),
        attachments: [],
        read_until: '2099-01-01T00:00:00Z',
        granted: false,
        revoked: false,
        origin: null,
        verified_zero_cost: false,
      },
    },
  }
  await page.route('**/api/workbench/sessions/*/capability-calls', (route) =>
    route.fulfill({ json: { calls: [call] } }),
  )
  await page.route('**/api/workbench/capability-calls/*/decision', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      decision: 'accept',
      token: call.detail.approval_token,
      subject_digest: call.digest,
      remember_read: true,
    })
    call.status = 'succeeded'
    call.detail.approval.granted = true
    return route.fulfill({ json: call })
  })
  await page.route('**/api/workbench/capability-calls/*/revoke-read', (route) => {
    expect(new URL(route.request().url()).pathname).toBe(
      `/api/workbench/capability-calls/${call.id}/revoke-read`,
    )
    call.detail.approval.revoked = true
    return route.fulfill({ json: call })
  })
  await page.goto(`/en/workbench/chat/${call.session_id}`)
  await page.getByRole('button', { name: /Capabilities for this conversation/ }).click()
  await expect(page.getByText('task · task-7')).toBeVisible()
  await page.getByRole('button', { name: 'Allow reads within this scope' }).click()
  await page.getByRole('button', { name: 'Revoke read approval' }).click()
  await expect(page.getByText('Read approval revoked.')).toBeVisible()
})

test('live isolated script card approves, downloads, resumes and stops the original calls', async ({
  context,
  page,
}) => {
  const sid = process.env.SCRIPT_CARD_SESSION
  test.skip(!sid, 'requires the local PostgreSQL and KIND script card probe')
  test.setTimeout(100_000)
  await context.addCookies([
    {
      name: 'sunmoonai_knowbench_web_sid',
      value: 'e2e-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  await page.goto(`/en/workbench/chat/${sid}`)
  const open = () =>
    page.getByRole('button', { name: /Capabilities for this conversation/ }).click()
  await open()
  const cards = page.locator('section').filter({ has: page.locator(':scope > h4') })
  const finish = cards.filter({ hasText: '"finish"' })
  const stop = cards.filter({ hasText: '"stop"' })
  await finish.getByRole('button', { name: 'Allow once' }).click()
  const artifact = finish.getByRole('link', { name: 'Download answer.txt' })
  await expect(artifact).toBeVisible({ timeout: 40_000 })
  const download = page.waitForEvent('download')
  await artifact.click()
  expect(await readFile((await (await download).path())!, 'utf8')).toBe('42')
  await stop.getByRole('button', { name: 'Allow once' }).click()
  await expect(stop.getByRole('button', { name: 'Stop script' })).toBeVisible({ timeout: 30_000 })
  await page.reload()
  await open()
  await stop.getByRole('button', { name: 'Stop script' }).click()
  await expect(stop.getByRole('heading')).toContainText('Provider reported failure', {
    timeout: 20_000,
  })
  await expect(finish.getByRole('link', { name: 'Download answer.txt' })).toBeVisible()
})

test('registry management follows an installed source to its two frozen versions', async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: 'sunmoonai_knowbench_web_sid',
      value: 'e2e-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  const id = '088208b5-a2b2-4f7b-a2b8-b5abdedff75d'
  await page.route('**/api/workbench/method-skill-center', (route) =>
    route.fulfill({
      json: {
        installed: [
          {
            asset_id: id,
            name: 'Office mail',
            kind: 'connection',
            revision: 1,
            status: 'active',
            account_label: 'office@example.test',
          },
        ],
        formal: ['Monthly report', 'Notify auditor'].map((title, i) => ({
          path: 'formal',
          method_kind: 'tool',
          runner_route: 'formal_mcp',
          allowed_callers: ['host'],
          title,
          reference: {
            method_id: 'b5ae2229-dfbc-46ac-9c30-895e75571c0' + i,
            version: 1,
            digest: 'sha256:' + 'a'.repeat(64),
          },
          source_asset_id: id,
          source_revision: 1,
          source_kind: 'mcp',
          source_entry: 'send',
          source_digest: 'sha256:' + 'b'.repeat(64),
          dependencies: [],
        })),
        native: [],
      },
    }),
  )
  await page.goto('/en/workbench/settings/method-skill-center')
  await expect(
    page.getByRole('heading', { name: 'Method and Skill Management Center', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: /Monthly report/ })).toBeVisible()
  await page.getByRole('button', { name: 'Installations', exact: true }).click()
  await expect(page.getByText('Office mail', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Formal Methods' }).click()
  await page.getByRole('searchbox').fill('auditor')
  await expect(page.getByRole('heading', { name: /Notify auditor/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Monthly report/ })).toHaveCount(0)
  const queries: unknown[] = []
  await page.route('**/api/workbench/method-skill-center/planning-methods?**', (route) => {
    expect(route.request().method()).toBe('POST')
    queries.push(route.request().postDataJSON())
    return route.fulfill({
      json: {
        items: [
          {
            method_id: id,
            latest_version: 2,
            digest: 'sha256:' + 'c'.repeat(64),
            method_kind: 'expert',
            title: 'Acquired reviewer',
            summary: 'Review a monthly report',
          },
        ],
        next: null,
      },
    })
  })
  await page.getByRole('button', { name: 'Planning candidates' }).click()
  await expect(page.getByRole('heading', { name: 'Acquired reviewer · v2' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Notify auditor/ })).toHaveCount(0)
  const question = 'Check the November report'
  await page.getByLabel('What question are you working on?').fill(question)
  await page.getByRole('button', { name: 'Find available experts' }).click()
  await expect.poll(() => queries.at(-1)).toEqual({ stage: 'expert', question })
  await page.getByRole('button', { name: 'Show tools and experts for composition' }).click()
  await expect.poll(() => queries.at(-1)).toEqual({ stage: 'composition', question })
  await page.route('**/planning-methods/declaration', (route) => {
    const ref = route.request().postDataJSON()
    expect(ref).toEqual({ method_id: id, version: 2, digest: 'sha256:' + 'c'.repeat(64) })
    return route.fulfill({
      json: {
        reference: ref,
        promise_outputs: { review: ['differences'] },
        declaration: {
          title: 'Reviewer',
          purpose: 'Audit reports',
          applies_when: ['Monthly filing'],
          excludes: ['Forecasts'],
          promises: { review: 'Checked figures' },
          conditions: { review: { when: 'Both ledgers supplied', input_slots: ['ledger'] } },
        },
      },
    })
  })
  await page.getByText('View version declaration', { exact: true }).click()
  await expect(page.getByText('Forecasts', { exact: true })).toBeVisible()
  await expect(page.getByText(/Both ledgers supplied/)).toBeVisible()
  await expect(page.getByText(/Output fields · differences/)).toBeVisible()
  await page.getByRole('button', { name: 'Browse all available versions' }).click()
  await expect(page.getByLabel('What question are you working on?')).toHaveValue('')
})

test('author registers a standalone script and publishes a second text revision', async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: 'sunmoonai_knowbench_web_sid',
      value: 'e2e-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])
  const records: {
    source_id: string
    version: number
    name: string
    kind: string
    content: string
    digest: string
  }[] = []
  await page.route('**/api/workbench/method-skill-center', (route) =>
    route.fulfill({ json: { formal: [], installed: [], native: [] } }),
  )
  await page.route('**/api/workbench/method-skill-center/sources**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/sources'))
      return route.fulfill({
        json: records.map(({ source_id, version, name, kind, digest }) => ({
          source_id,
          version,
          name,
          kind,
          digest,
        })),
      })
    const parts = url.pathname.split('/')
    const version = Number(parts.pop()),
      source_id = parts.pop()!
    if (route.request().method() === 'PUT') {
      const row = {
        ...route.request().postDataJSON(),
        source_id,
        version,
        digest: 'sha256:' + String(version).repeat(64),
      }
      records.push(row)
      return route.fulfill({ json: row })
    }
    const row = records.find(
      (row) =>
        row.source_id === source_id &&
        row.version === version &&
        row.digest === url.searchParams.get('digest'),
    )
    return route.fulfill({ status: row ? 200 : 404, json: row ?? {} })
  })
  await page.goto('/en/workbench/settings/method-skill-center')
  await page.getByRole('button', { name: 'Scripts and instructions' }).click()
  await page.getByRole('button', { name: 'New registration' }).click()
  await page.getByLabel('Load from file').setInputFiles({
    name: 'reconcile.py',
    mimeType: 'text/plain',
    buffer: Buffer.from('print(1)\n'),
  })
  await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue(
    'print(1)\n',
  )
  await page.getByRole('button', { name: 'Register v1' }).click()
  await page.getByRole('button', { name: 'Create new version' }).click()
  await page.getByRole('textbox', { name: 'Content', exact: true }).fill('print(2)')
  await page.getByRole('button', { name: 'Register v2' }).click()
  await expect(page.getByRole('button', { name: 'reconcile.py · v2 · Script' })).toBeVisible()
  expect(records.map((r) => [r.version, r.content])).toEqual([
    [1, 'print(1)\n'],
    [2, 'print(2)'],
  ])
  expect(records[0].source_id).toBe(records[1].source_id)
})
