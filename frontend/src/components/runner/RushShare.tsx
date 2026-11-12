// The "show off your run" sheet: a preview of the share card plus three ways out —
// the phone's share sheet, saving the picture, or copying the link. The card is drawn
// before this sheet offers to share, so the Share tap opens the system sheet directly;
// a browser only allows that while a tap is fresh.
import { useState } from 'react'
import { Check, Copy, Download, Loader2, Share2, X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { canShareImage, copyText, saveImage, sendImage } from '../../lib/shareCard'

export type ShareSheetState =
  | { status: 'making' }
  | { status: 'ready'; blob: Blob; url: string }
  | { status: 'error' }

export function RushShareSheet({
  state,
  text,
  link,
  onToast,
  onClose,
}: {
  state: ShareSheetState
  text: string
  link: string
  onToast: (kind: 'good' | 'warn', key: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const ready = state.status === 'ready' ? state : null
  const canSend = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const withImage = ready ? canShareImage(ready.blob) : false

  const send = async () => {
    if (!ready || sending) return
    setSending(true)
    const outcome = await sendImage(ready.blob, text, link)
    setSending(false)
    if (outcome === 'failed' || outcome === 'unsupported') onToast('warn', 'share.failed')
  }
  const save = () => {
    if (!ready) return
    saveImage(ready.url)
    onToast('good', 'share.saved')
  }
  const copy = async () => {
    if (await copyText(`${text} ${link}`)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } else onToast('warn', 'share.failed')
  }

  return (
    <div
      className="ar-screen ar-share-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ar-panel ar-modal ar-share">
        <div className="flex items-center justify-between gap-3">
          <div className="ar-modal-title">
            <Share2 size={15} className="mr-2 inline" />
            {t('share.title')}
          </div>
          <button className="ar-btn ar-btn-sm" onClick={onClose}>
            <X size={14} /> {t('board.close')}
          </button>
        </div>

        <div className="ar-share-frame">
          {ready ? (
            <img src={ready.url} alt={t('share.title')} className="ar-share-img" />
          ) : state.status === 'making' ? (
            <div className="ar-share-wait">
              <Loader2 size={26} className="ar-spin-icon" />
              <span>{t('share.making')}</span>
            </div>
          ) : (
            <div className="ar-share-wait">
              <span>{t('share.error')}</span>
            </div>
          )}
        </div>
        {ready && <p className="ar-share-hold">{t('share.hold')}</p>}

        <div className="ar-share-actions">
          {canSend && (
            <button className="ar-btn ar-btn-primary" disabled={!ready || sending} onClick={() => void send()}>
              {sending ? <Loader2 size={15} className="ar-spin-icon" /> : <Share2 size={15} />}{' '}
              {withImage ? t('share.send') : t('share.sendLink')}
            </button>
          )}
          <div className="ar-menu-row">
            <button className="ar-btn" disabled={!ready} onClick={save}>
              <Download size={14} /> {t('share.save')}
            </button>
            <button className="ar-btn" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('auth.copied') : t('share.copyLink')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
