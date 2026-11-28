import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { z } from 'zod'

const httpOrigin = z.url().refine((value) => {
  const url = new URL(value)
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  )
}, 'must be an HTTP(S) origin without credentials, path, query or fragment')

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEPLOYMENT_ENV: z.enum(['development', 'test', 'production']).optional(),
  AUTH_APP: z.enum(['tpl', 'knowfeed', 'knowbase', 'research', 'knowbench']).optional(),
  APP_ORIGIN: httpOrigin.optional(),
  BACKEND_INTERNAL_URL: httpOrigin.optional(),
  DEPLOYMENT_ID: z.string().trim().min(1).optional(),
  REFERENCE_UI_ENABLED: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema> & {
  DEPLOYMENT_ENV: 'development' | 'test' | 'production'
  AUTH_APP: 'tpl' | 'knowfeed' | 'knowbase' | 'research' | 'knowbench'
  APP_ORIGIN: string
  BACKEND_INTERNAL_URL: string
  DEPLOYMENT_ID: string
  REFERENCE_UI_ENABLED: boolean
}

type ParseServerEnvOptions = {
  phase?: string
}

export function parseServerEnv(
  input: Record<string, string | undefined>,
  options: ParseServerEnvOptions = {},
): ServerEnv {
  const parsed = serverEnvSchema.parse(input)
  const isProductionBuild = options.phase === PHASE_PRODUCTION_BUILD
  const allowLocalDefaults = parsed.NODE_ENV !== 'production' || isProductionBuild
  const deploymentEnv =
    parsed.DEPLOYMENT_ENV ?? (allowLocalDefaults ? 'development' : undefined)

  const appOrigin = parsed.APP_ORIGIN ?? (allowLocalDefaults ? 'http://localhost:3000' : undefined)
  const backendInternalUrl =
    parsed.BACKEND_INTERNAL_URL ?? (allowLocalDefaults ? 'http://127.0.0.1:8000' : undefined)
  const deploymentId = parsed.DEPLOYMENT_ID ?? (allowLocalDefaults ? 'local' : undefined)
  const authApp = parsed.AUTH_APP ?? (allowLocalDefaults ? 'knowbench' : undefined)
  const referenceUiEnabled = parsed.REFERENCE_UI_ENABLED ?? false

  if (!deploymentEnv || !appOrigin || !backendInternalUrl || !deploymentId || !authApp) {
    throw new Error(
      'Invalid server environment: DEPLOYMENT_ENV, AUTH_APP, APP_ORIGIN, BACKEND_INTERNAL_URL and DEPLOYMENT_ID are required at production runtime',
    )
  }
  if (deploymentEnv === 'production' && !appOrigin.startsWith('https://')) {
    throw new Error('Invalid server environment: APP_ORIGIN must use HTTPS in a production deployment')
  }
  if (
    deploymentEnv === 'test' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(appOrigin).hostname)
  ) {
    throw new Error('Invalid server environment: test APP_ORIGIN must use a loopback host')
  }

  return {
    ...parsed,
    DEPLOYMENT_ENV: deploymentEnv,
    AUTH_APP: authApp,
    APP_ORIGIN: appOrigin,
    BACKEND_INTERNAL_URL: backendInternalUrl,
    DEPLOYMENT_ID: deploymentId,
    REFERENCE_UI_ENABLED: referenceUiEnabled,
  }
}
