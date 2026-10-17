import { getRequestConfig } from 'next-intl/server'
import { routing } from './i18n/routing'

export const locales = routing.locales
export type Locale = (typeof locales)[number]
export const defaultLocale = routing.defaultLocale

export { routing }

// 页面上的时间一律按北京时间显示（账 131）。不写的话按服务器的时区，容器里是协调世界时，慢 8 小时
export const TIME_ZONE = 'Asia/Shanghai'

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale
  if (!locale || !locales.includes(locale as Locale)) {
    locale = defaultLocale
  }

  return {
    locale,
    timeZone: TIME_ZONE,
    messages: (await import(`./messages/${locale}.json`)).default,
  }
})
