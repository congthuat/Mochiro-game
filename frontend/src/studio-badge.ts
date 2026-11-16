// "Built with Surf Studio" and "Built with Arc Studio" badges, pinned to the bottom-right corner.
// Plain DOM (not React) so it never interferes with hydration.

const LOGO_PATH =
  'M0 21.5001C0.167192 16.2366 1.02308 11.3243 2.45378 7.50459C4.26573 2.66517 6.88869 0 9.83904 0C12.7894 0 15.412 2.66517 17.2243 7.50459C18.1669 10.0216 18.8605 13.0121 19.2713 16.2655C19.3081 16.556 19.3393 16.8513 19.3714 17.146C19.3819 17.1642 19.3881 17.1811 19.386 17.1949C19.386 17.1949 19.6275 18.7674 19.6788 21.5001H19.6515C19.2934 21.1937 15.0694 17.7329 8.06739 18.735C8.17304 17.4996 8.31833 16.2974 8.50603 15.1452C8.51562 15.0863 8.52671 15.0294 8.53649 14.9709C11.2828 14.8846 13.6866 15.2171 15.5299 15.6529C15.5231 15.6073 15.5173 15.5603 15.5103 15.5149C15.1314 13.0547 14.5724 10.8024 13.8517 8.87761C12.6732 5.73037 11.1354 3.77496 9.83904 3.77496C8.54269 3.77496 7.00493 5.73037 5.82649 8.87761C5.54123 9.63889 5.28154 10.4508 5.04866 11.3071C4.72126 12.507 4.44621 13.7934 4.22654 15.1451C3.90141 17.1412 3.69827 19.2821 3.62345 21.5001H0Z'

// Surf mark, from asksurf.ai/assets/logo-text.svg (the wave glyph only).
const SURF_PATH =
  'M91.9661 91.3713C94.5355 91.3713 96.9664 92.5398 98.5715 94.5461L111.906 111.213C112.091 111.445 112.284 111.661 112.484 111.863C114.656 114.051 117.422 116.478 117.422 119.562C117.422 122.724 114.859 125.287 111.697 125.287H110.024C107.776 125.287 105.651 124.266 104.247 122.511L96.8547 113.272C92.4293 107.74 83.5091 110.869 83.509 117.953V125.287L83.5081 125.286V124.656C83.508 125.012 83.2076 125.287 82.8518 125.287H71.1204C67.0781 125.287 63.2551 123.45 60.7297 120.293L55.1116 113.272C50.6861 107.74 41.7659 110.869 41.7659 117.953V124.656C41.7659 125.013 41.4637 125.287 41.1077 125.287H29.3782C25.3357 125.287 21.5119 123.45 18.9866 120.293L13.3694 113.272C11.1382 110.483 7.84692 107.618 7.84692 104.046V92.0305C7.84692 91.6734 8.12266 91.3715 8.47974 91.3713C11.0489 91.3713 13.4792 92.5391 15.0842 94.5452L28.4192 111.213C32.8445 116.745 41.7645 113.616 41.7649 106.532L41.7659 91.3713V99.8293C41.7659 95.1582 45.5527 91.3714 50.2239 91.3713C52.7931 91.3715 55.2233 92.5399 56.8284 94.5461L70.1624 111.213C74.5741 116.728 83.4534 113.635 83.5081 106.597V99.8293C83.5081 95.1583 87.2951 91.3716 91.9661 91.3713ZM91.9661 49.6282C94.5355 49.6282 96.9664 50.7966 98.5715 52.803L111.906 69.4709C114.135 72.2577 117.422 75.1208 117.422 78.6897V90.7161C117.422 91.0705 117.149 91.3713 116.794 91.3713C114.225 91.3713 111.795 90.2035 110.19 88.1975L96.8547 71.5286C92.4293 65.9973 83.5092 69.1264 83.509 76.2102L83.5081 91.3713V82.9133C83.5081 87.5842 79.7219 91.3712 75.051 91.3713C72.4819 91.3713 70.0515 90.2036 68.4465 88.1975L55.1116 71.5286C50.6861 65.9975 41.7661 69.1264 41.7659 76.2102V82.9133C41.7659 87.5843 37.9788 91.3713 33.3079 91.3713C30.7387 91.3713 28.3083 90.2037 26.7034 88.1975L13.3694 71.5286C11.1382 68.7396 7.84692 65.8745 7.84692 62.303V50.2874C7.84692 49.9302 8.12266 49.6283 8.47974 49.6282C11.049 49.6282 13.4792 50.7967 15.0842 52.803L28.4192 69.4709C32.8446 75.0021 41.7647 71.8731 41.7649 64.7893L41.7659 49.6282V58.0862C41.766 53.4151 45.5528 49.6283 50.2239 49.6282C52.7931 49.6283 55.2233 50.7967 56.8284 52.803L70.1624 69.4709C74.5741 74.9854 83.4531 71.8924 83.5081 64.8547V58.0862C83.5082 53.4152 87.2951 49.6285 91.9661 49.6282ZM15.2493 15.7122C17.4975 15.7123 19.624 16.734 21.0286 18.4895L28.4192 27.7278C32.8446 33.2592 41.7648 30.1301 41.7649 23.0461L41.7659 41.1711C41.7657 45.8419 37.9787 49.6282 33.3079 49.6282C30.7387 49.6281 28.3083 48.4606 26.7034 46.4543L13.3694 29.7854C13.1831 29.5526 12.9886 29.3346 12.7874 29.1321C10.6138 26.9449 7.84694 24.5182 7.84692 21.4348C7.84692 18.2743 10.4091 15.7123 13.5696 15.7122H15.2493ZM54.1536 15.7122C58.1965 15.7122 62.0206 17.5503 64.5461 20.7073L70.1624 27.7278C74.5741 33.2424 83.4533 30.1494 83.5081 23.1116V16.343C83.5081 15.9869 83.8102 15.7122 84.1663 15.7122H95.8967C99.9397 15.7122 103.764 17.5503 106.289 20.7073L111.906 27.7278C114.135 30.5146 117.422 33.3777 117.422 36.9465V48.9729C117.422 49.3273 117.149 49.6282 116.794 49.6282C114.225 49.6281 111.795 48.4604 110.19 46.4543L96.8547 29.7854C92.4293 24.2544 83.5094 27.3834 83.509 34.467L83.5081 49.6282V41.1711C83.5078 45.8419 79.7218 49.628 75.051 49.6282C72.4819 49.6281 70.0515 48.4605 68.4465 46.4543L55.1116 29.7854C50.6861 24.2545 41.7662 27.3835 41.7659 34.467V16.343C41.7659 15.987 42.067 15.7122 42.4231 15.7122H54.1536Z'

const BADGE_CSS = `
#studio-badges{position:fixed;z-index:40;display:flex;flex-direction:column;align-items:flex-end;gap:8px;
  right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));
  transition:opacity .2s ease,transform .2s ease}
.studio-badge{display:flex;align-items:center;gap:6px;
  padding:8px 14px;font:600 12px/1 system-ui,-apple-system,sans-serif;color:#1B3158;text-decoration:none;
  background:rgba(172,198,233,.85);-webkit-backdrop-filter:blur(12px) saturate(180%);backdrop-filter:blur(12px) saturate(180%);
  border-radius:20px;border:1px solid rgba(255,255,255,.4);
  box-shadow:0 4px 20px rgba(27,49,88,.15),inset 0 1px 0 rgba(255,255,255,.5);
  transition:transform .15s ease,box-shadow .15s ease;-webkit-tap-highlight-color:transparent}
.studio-badge:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(27,49,88,.22),inset 0 1px 0 rgba(255,255,255,.5)}
.studio-badge svg{flex:none}
#surf-studio-badge{color:#fff;background:rgba(14,18,28,.82);border-color:rgba(255,255,255,.14);
  box-shadow:0 4px 20px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.08)}
/* Phones: logos only, side by side in the bottom-left corner, away from every on-screen control. */
@media (max-width:760px),(max-height:500px){
  #studio-badges{flex-direction:row;align-items:center;gap:6px;right:auto;
    left:calc(8px + env(safe-area-inset-left,0px));bottom:calc(8px + env(safe-area-inset-bottom,0px));opacity:.8}
  .studio-badge{padding:0;width:28px;height:28px;justify-content:center;border-radius:50%}
  .studio-badge span{display:none}
  #arc-studio-badge svg{width:12px;height:13px}
  #surf-studio-badge svg{width:15px;height:15px}
}
/* While a run, the pause screen or the results are up, the game owns the whole screen. */
html[data-phase="playing"] #studio-badges,html[data-phase="paused"] #studio-badges,
html[data-phase="gameover"] #studio-badges,html[data-phase="countdown"] #studio-badges{
  opacity:0;pointer-events:none;transform:translateY(8px);visibility:hidden}
`

function badge(id: string, href: string, label: string, icon: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.id = id
  a.className = 'studio-badge'
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.setAttribute('aria-label', label)
  a.innerHTML = icon + `<span>${label}</span>`
  return a
}

export function mountStudioBadge(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('studio-badges')) return

  const style = document.createElement('style')
  style.id = 'studio-badges-style'
  style.textContent = BADGE_CSS
  document.head.appendChild(style)

  const wrap = document.createElement('div')
  wrap.id = 'studio-badges'
  wrap.appendChild(
    badge(
      'surf-studio-badge',
      'https://asksurf.ai/studio',
      'Built with Surf Studio',
      `<svg width="15" height="15" viewBox="6 14 114 114" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${SURF_PATH}" fill="currentColor"/></svg>`
    )
  )
  wrap.appendChild(
    badge(
      'arc-studio-badge',
      'https://studio.arc.io/',
      'Built with Arc Studio',
      `<svg width="14" height="16" viewBox="0 0 20 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${LOGO_PATH}" fill="currentColor"/></svg>`
    )
  )
  document.body.appendChild(wrap)
}
