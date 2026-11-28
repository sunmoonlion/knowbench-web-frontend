// 个人偏好（0021 §二之 1）存在浏览器本地。这一段在页面还没画之前就跑，把外观、主题色、侧边栏宽度
// 套到 <html> 上，免得先亮后暗闪一下。内容要和 lib/preferences.ts 的 applyPreferences 一致。
export const PREFERENCES_KEY = 'sunmoon.preferences'

export const PREFERENCES_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFERENCES_KEY)})||'{}')||{};var a=p.appearance;var d=a==='dark'||(a!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);if(p.accent)r.dataset.accent=p.accent;if(p.sidebar)r.dataset.sidebar=p.sidebar;}catch(e){}})()`
