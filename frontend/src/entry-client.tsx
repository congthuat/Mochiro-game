import './index.css'
import { mountStudioBadge } from './studio-badge'

mountStudioBadge()

// ---------------------------------------------------------------------------
// Cold-start guard: verify React is real BEFORE rendering.
//
// During Vite dep-optimization (cold start or after `npm install <pkg>`),
// Vite may serve placeholder "stub" modules where all React exports are
// undefined.  Rendering with stub hooks causes "Cannot read properties of
// null (reading 'useState')".
//
// Strategy:
//   1. Dynamic-import React and check if useState is a function.
//   2. If stub  → show a loading banner, schedule a reload with increasing
//      delay, and do NOT mount any React tree (avoids the error entirely).
//   3. If real  → dynamic-import App/ErrorBoundary and render normally.
//   4. Use createElement (not JSX) in this file so Vite doesn't inject a
//      static `import { jsx } from 'react/jsx-dev-runtime'` which would
//      itself be a stub and crash before our guard runs.
// ---------------------------------------------------------------------------

const RELOAD_KEY = '__dep_reload'
const MAX_RELOADS = 6
const RELOAD_WINDOW = 60_000 // 1 minute

function getReloads(): { c: number; t: number } {
  try {
    return JSON.parse(sessionStorage.getItem(RELOAD_KEY) || '{}') as { c: number; t: number }
  } catch { return { c: 0, t: 0 } }
}

async function boot() {
  const root = document.getElementById('root')!

  try {
    const React = await import('react')

    // If useState is not a function, React is a dep-optimization stub
    if (typeof React.useState !== 'function') throw new Error('dep-stub')

    const { createElement } = React
    const { createRoot, hydrateRoot } = await import('react-dom/client')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { default: App } = await import('./App')
    const { default: ErrorBoundary } = await import('./ErrorBoundary')

    const queryClient = new QueryClient({
      defaultOptions: { queries: {
        refetchOnWindowFocus: false,
        retry: 3,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
        staleTime: 30_000,
      } },
    })

    const children = createElement(ErrorBoundary, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(App)
      )
    )

    // Use hydrateRoot only when SSR rendered real app content. The scaffold's
    // server entry intentionally returns a lightweight placeholder shell so
    // SSR-incompatible libraries (for example echarts-for-react) cannot crash
    // deploy-time render. Placeholder markup must be client-rendered, not hydrated.
    const hasPlaceholder = !!root.querySelector('[data-surf-placeholder]')
    if (root.childNodes.length > 0 && root.innerHTML !== '<!--ssr-outlet-->' && !hasPlaceholder) {
      hydrateRoot(root, children)
    } else {
      root.innerHTML = ''
      createRoot(root).render(children)
    }

    // React rendered successfully — signal to index.html fallback & reset counter
    ;(window as any).__reactOk = true
    sessionStorage.removeItem(RELOAD_KEY)

    // Notify parent frame when real app content renders (not the placeholder).
    // DO NOT REMOVE — the hosting app uses this to dismiss the loading overlay.
    function notifyParentReady() {
      if (!document.querySelector('[data-surf-placeholder]')) {
        try { window.parent.postMessage({ type: 'surf-app-ready' }, '*') } catch { /* cross-origin — ignore */ }
      }
    }
    notifyParentReady()
    new MutationObserver(notifyParentReady).observe(root, { childList: true, subtree: true })
  } catch {
    // Production never serves dep stubs: reaching here means a script failed to download
    // (a weak or dropped connection). Retry a couple of times, waiting for the network to
    // come back first, then hand the player a clear message and a reload button.
    showBootFailure(root)
  }
}

function bootLang(): 'vi' | 'en' {
  try {
    const saved = localStorage.getItem('arcrush.lang')
    if (saved === 'vi' || saved === 'en') return saved
  } catch { /* storage blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

const BOOT_TEXT = {
  vi: {
    title: 'Chưa tải được Mochiro',
    body: 'Kết nối bị gián đoạn trong lúc tải game. Kiểm tra mạng rồi thử lại nhé.',
    retrying: 'Đang thử tải lại…',
    reload: 'Tải lại',
  },
  en: {
    title: 'Mochiro didn’t finish loading',
    body: 'The connection dropped while the game was loading. Check your network and try again.',
    retrying: 'Trying again…',
    reload: 'Reload',
  },
}

function showBootFailure(root: HTMLElement) {
  // This screen owns the retries from here on, so the index.html watchdog stands down.
  ;(window as any).__reactOk = true
  const text = BOOT_TEXT[bootLang()]
  const prev = getReloads()
  const count = (Date.now() - prev.t > RELOAD_WINDOW) ? 0 : prev.c
  const autoRetry = count < 2
  root.innerHTML = [
    '<div style="min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(180deg,#0b1d47,#16306b);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">',
    '<div style="max-width:360px;width:100%;padding:24px 22px;border-radius:18px;background:rgba(255,255,255,.96);color:#16233d;text-align:center;box-shadow:0 18px 48px rgba(0,0,0,.35)">',
    '<p style="margin:0 0 8px;font-size:18px;font-weight:800">' + text.title + '</p>',
    '<p style="margin:0 0 16px;font-size:14px;line-height:1.45;color:#33455f">' + text.body + '</p>',
    '<p id="boot-retrying" style="margin:0 0 12px;font-size:12.5px;color:#2b6fd8;' + (autoRetry ? '' : 'display:none') + '">' + text.retrying + '</p>',
    '<button id="boot-reload" type="button" style="width:100%;padding:12px 16px;border:0;border-radius:12px;background:#2b6fd8;color:#fff;font-size:15px;font-weight:700;cursor:pointer">' + text.reload + '</button>',
    '</div></div>',
  ].join('')
  const reload = () => {
    try { sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ c: count + 1, t: Date.now() })) } catch { /* ignore */ }
    location.reload()
  }
  document.getElementById('boot-reload')?.addEventListener('click', reload)
  if (!autoRetry) return
  if (navigator.onLine === false) window.addEventListener('online', () => setTimeout(reload, 1200), { once: true })
  else setTimeout(reload, 4000 + count * 4000)
}

boot()
