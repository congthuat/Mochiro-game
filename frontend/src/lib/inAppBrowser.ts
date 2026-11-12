// In-app browsers — the webview inside Zalo, Facebook, Messenger, Instagram, TikTok and friends.
//
// They matter for one specific reason: Google refuses to run its sign-in inside them and
// answers 403 disallowed_useragent. A player who taps a link in Zalo gets a sign-in screen
// that cannot work, and nothing on the page explains why. So we detect the webview and
// offer a real way out — a tap that reopens the page in the phone's own browser.

const KNOWN: [RegExp, string][] = [
  [/Zalo/i, 'Zalo'],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, 'Facebook'],
  [/Messenger|Orca-Android/i, 'Messenger'],
  [/Instagram/i, 'Instagram'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/\bLine\//i, 'Line'],
  [/KAKAOTALK/i, 'KakaoTalk'],
  [/MicroMessenger/i, 'WeChat'],
  [/Telegram/i, 'Telegram'],
  [/Twitter/i, 'X'],
]

/** The name of the app whose webview we are inside, or null for a real browser. */
export function inAppBrowser(): string | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent || ''
  for (const [pattern, name] of KNOWN) if (pattern.test(ua)) return name
  // A bare Android webview: "…; wv)" with no app name to match.
  if (/Android/i.test(ua) && /; wv\)/.test(ua)) return 'app'
  return null
}

/**
 * A link that reopens this page in the phone's real browser, or null when there is no such
 * link on this platform. iOS answers to the `x-safari-https` scheme; Android answers to an
 * `intent://` URL aimed at Chrome. Both are best effort — the button only appears when we
 * produced something to tap.
 */
export function openInBrowserHref(): string | null {
  if (typeof window === 'undefined') return null
  const ua = navigator.userAgent || ''
  const { host, pathname, search, hash } = window.location
  if (/Android/i.test(ua)) {
    return `intent://${host}${pathname}${search}${hash}#Intent;scheme=https;package=com.android.chrome;end`
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return `x-safari-https://${host}${pathname}${search}${hash}`
  return null
}

/** What to call the browser we are trying to reach, for the button's label. */
export function nativeBrowserName(): string {
  if (typeof navigator === 'undefined') return 'browser'
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'Safari' : 'Chrome'
}
