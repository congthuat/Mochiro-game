import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { error: Error | null }

// Production build of the boundary. A player must never see a raw stack message in
// English: they get a short, translated note and a reload button. A chunk that failed
// to download (weak network, or a new deploy replaced the old files) reloads by itself,
// at most once a minute so a broken network can never cause a reload loop.
const CHUNK_KEY = '__chunk_reload'
const CHUNK_WINDOW_MS = 60_000

const CHUNK_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Unable to preload CSS',
  'ChunkLoadError',
]

function isChunkError(error: Error): boolean {
  const text = `${error.name} ${error.message}`
  return CHUNK_PATTERNS.some((pattern) => text.includes(pattern))
}

function lang(): 'vi' | 'en' {
  try {
    const saved = localStorage.getItem('arcrush.lang')
    if (saved === 'vi' || saved === 'en') return saved
  } catch { /* storage blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

const TEXT = {
  vi: {
    title: 'Đã có lỗi xảy ra',
    body: 'Game gặp một lỗi không mong muốn. Tải lại trang thường sẽ khắc phục được — tiến độ của bạn vẫn an toàn.',
    netTitle: 'Chưa tải được Mochiro',
    netBody: 'Kết nối bị gián đoạn trong lúc tải game. Kiểm tra mạng rồi thử lại nhé.',
    reload: 'Tải lại',
  },
  en: {
    title: 'Something went wrong',
    body: 'The game hit an unexpected error. Reloading the page usually fixes it — your progress is safe.',
    netTitle: 'Mochiro didn’t finish loading',
    netBody: 'The connection dropped while the game was loading. Check your network and try again.',
    reload: 'Reload',
  },
}

function recentChunkReload(): boolean {
  try {
    const at = Number(sessionStorage.getItem(CHUNK_KEY) || 0)
    return Date.now() - at < CHUNK_WINDOW_MS
  } catch {
    return true
  }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (!isChunkError(error) || recentChunkReload()) return
    const reload = () => {
      try { sessionStorage.setItem(CHUNK_KEY, String(Date.now())) } catch { /* ignore */ }
      location.reload()
    }
    if (navigator.onLine === false) window.addEventListener('online', () => setTimeout(reload, 1200), { once: true })
    else setTimeout(reload, 1500)
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback
    const text = TEXT[lang()]
    const network = isChunkError(this.state.error)
    return (
      <div
        role="alert"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'linear-gradient(180deg,#0b1d47,#16306b)',
          fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 360,
            width: '100%',
            padding: '24px 22px',
            borderRadius: 18,
            background: 'rgba(255,255,255,.96)',
            color: '#16233d',
            textAlign: 'center',
            boxShadow: '0 18px 48px rgba(0,0,0,.35)',
          }}
        >
          <p style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800 }}>{network ? text.netTitle : text.title}</p>
          <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.45, color: '#33455f' }}>
            {network ? text.netBody : text.body}
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: 0,
              borderRadius: 12,
              background: '#2b6fd8',
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {text.reload}
          </button>
        </div>
      </div>
    )
  }
}
