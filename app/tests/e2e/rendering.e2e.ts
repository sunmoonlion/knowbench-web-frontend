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

test('paired unified Backend contract streams, cites, reconciles and accepts HITL', async ({
  context,
  page,
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
  await page.goto('/en/dashboard')

  await page.getByLabel('Research question').fill('Use the authorized evidence')
  await page.getByRole('button', { name: 'Start research' }).click()

  await expect(page.getByText('A streamed FastAPI response fragment.')).toBeVisible()
  const source = page.getByRole('link', { name: 'FastAPI authorized reference' })
  await expect(source).toBeVisible()
  await expect(page.getByTestId('run-status')).toHaveText('Waiting for input')

  const sourceHref = await source.getAttribute('href')
  if (!sourceHref) throw new Error('citation source href is missing')
  const anonymousSource = await request.get(sourceHref, { maxRedirects: 0 })
  expect(anonymousSource.status()).toBe(401)
  const sourceResponse = await request.get(sourceHref, {
    headers: { Cookie: 'sunmoonai_knowbench_web_sid=e2e-session' },
    maxRedirects: 0,
  })
  expect(sourceResponse.status()).toBe(302)
  expect(sourceResponse.headers().location).toContain('/api/web/v1/reference/sources/')

  await page.getByRole('button', { name: 'Confirm and continue' }).click()
  await expect(page.getByTestId('run-status')).toHaveText('Succeeded')
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
