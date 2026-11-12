// Installable app: the web manifest, the offline worker, and the "add to home screen"
// offer. index.html is owned by the scaffold, so the manifest link is added from here.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type PwaInstall =
  | { kind: 'prompt'; prompt: () => Promise<boolean> }
  /** iOS Safari has no install prompt; the player is shown how to do it by hand. */
  | { kind: 'ios' }

function standalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Only the real site gets a service worker: never the dev server or a preview frame. */
function productionHost(): boolean {
  return import.meta.env.PROD && /(^|\.)mochiro\.xyz$/.test(window.location.hostname) && window.top === window.self
}

/** Wires everything up; calls `onChange` with what install offer (if any) is available. Returns a cleanup. */
export function setupPwa(onChange: (install: PwaInstall | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = '/manifest.webmanifest'
    document.head.appendChild(link)
  }

  if (productionHost() && 'serviceWorker' in navigator) {
    const register = () => void navigator.serviceWorker.register('/sw.js').catch(() => {})
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }

  if (standalone()) return () => {}

  const onPrompt = (event: Event) => {
    event.preventDefault()
    const deferred = event as BeforeInstallPromptEvent
    onChange({
      kind: 'prompt',
      prompt: async () => {
        await deferred.prompt()
        const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' as const }))
        return choice.outcome === 'accepted'
      },
    })
  }
  const onInstalled = () => onChange(null)
  window.addEventListener('beforeinstallprompt', onPrompt)
  window.addEventListener('appinstalled', onInstalled)

  const ua = navigator.userAgent
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|GSA|FBAN|FBAV|Instagram|Line|Zalo/i.test(ua)
  if (ios && safari) onChange({ kind: 'ios' })

  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt)
    window.removeEventListener('appinstalled', onInstalled)
  }
}
