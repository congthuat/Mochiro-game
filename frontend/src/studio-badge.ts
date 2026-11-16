// "Built with Arc Studio" badge, pinned to the bottom-right corner.
// Plain DOM (not React) so it never interferes with hydration.

const LOGO_PATH =
  'M0 21.5001C0.167192 16.2366 1.02308 11.3243 2.45378 7.50459C4.26573 2.66517 6.88869 0 9.83904 0C12.7894 0 15.412 2.66517 17.2243 7.50459C18.1669 10.0216 18.8605 13.0121 19.2713 16.2655C19.3081 16.556 19.3393 16.8513 19.3714 17.146C19.3819 17.1642 19.3881 17.1811 19.386 17.1949C19.386 17.1949 19.6275 18.7674 19.6788 21.5001H19.6515C19.2934 21.1937 15.0694 17.7329 8.06739 18.735C8.17304 17.4996 8.31833 16.2974 8.50603 15.1452C8.51562 15.0863 8.52671 15.0294 8.53649 14.9709C11.2828 14.8846 13.6866 15.2171 15.5299 15.6529C15.5231 15.6073 15.5173 15.5603 15.5103 15.5149C15.1314 13.0547 14.5724 10.8024 13.8517 8.87761C12.6732 5.73037 11.1354 3.77496 9.83904 3.77496C8.54269 3.77496 7.00493 5.73037 5.82649 8.87761C5.54123 9.63889 5.28154 10.4508 5.04866 11.3071C4.72126 12.507 4.44621 13.7934 4.22654 15.1451C3.90141 17.1412 3.69827 19.2821 3.62345 21.5001H0Z'

const BADGE_CSS = `
#arc-studio-badge{position:fixed;z-index:40;display:flex;align-items:center;gap:6px;
  right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));
  padding:8px 14px;font:600 12px/1 system-ui,-apple-system,sans-serif;color:#1B3158;text-decoration:none;
  background:rgba(172,198,233,.85);-webkit-backdrop-filter:blur(12px) saturate(180%);backdrop-filter:blur(12px) saturate(180%);
  border-radius:20px;border:1px solid rgba(255,255,255,.4);
  box-shadow:0 4px 20px rgba(27,49,88,.15),inset 0 1px 0 rgba(255,255,255,.5);
  transition:opacity .2s ease,transform .2s ease;-webkit-tap-highlight-color:transparent}
#arc-studio-badge svg{flex:none}
/* Phones: logo only, tucked in the top-left corner, away from every on-screen control. */
@media (max-width:760px),(max-height:500px){
  #arc-studio-badge{padding:0;width:28px;height:28px;justify-content:center;border-radius:50%;
    right:auto;bottom:auto;left:calc(8px + env(safe-area-inset-left,0px));top:auto;
    bottom:calc(8px + env(safe-area-inset-bottom,0px));opacity:.8}
  #arc-studio-badge span{display:none}
  #arc-studio-badge svg{width:12px;height:13px}
}
/* While a run, the pause screen or the results are up, the game owns the whole screen. */
html[data-phase="playing"] #arc-studio-badge,html[data-phase="paused"] #arc-studio-badge,
html[data-phase="gameover"] #arc-studio-badge,html[data-phase="countdown"] #arc-studio-badge{
  opacity:0;pointer-events:none;transform:translateY(8px);visibility:hidden}
`

export function mountStudioBadge(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('arc-studio-badge')) return

  const style = document.createElement('style')
  style.id = 'arc-studio-badge-style'
  style.textContent = BADGE_CSS
  document.head.appendChild(style)

  const a = document.createElement('a')
  a.id = 'arc-studio-badge'
  a.href = 'https://studio.arc.io/'
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.setAttribute('aria-label', 'Built with Arc Studio')
  a.innerHTML =
    `<svg width="14" height="16" viewBox="0 0 20 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${LOGO_PATH}" fill="currentColor"/></svg>` +
    '<span>Built with Arc Studio</span>'

  document.body.appendChild(a)
}
