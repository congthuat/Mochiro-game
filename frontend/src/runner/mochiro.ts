// The Mochiro mark, as data.
//
// It lives here rather than beside the component so that plain scripts can build it
// too — the browser-tab icon and the check that measures the mark are both just
// strings, and neither should have to pull in React to get one.
//
// One source of truth: the component and the tab icon are the same SVG, so they can
// never drift apart.
//
// What it says: a soft, forward-leaning M (the chibi heroes, the "mochi" in the name)
// standing in three speed streaks (the running). The M is drawn twice — a dark copy
// nudged down, then the lit one — which is what makes it sit on the badge instead of
// floating over it. The badge is a squircle rather than a coin on purpose: the road is
// full of coins already, and the mark has to read as *this game*, not as another pickup.
export function mochiroMarkSvg(size = 64, id = 'moc'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
<defs>
<linearGradient id="${id}-edge" x1="4" y1="2" x2="60" y2="62" gradientUnits="userSpaceOnUse"><stop stop-color="#8ceaff"/><stop offset=".45" stop-color="#4d8dff"/><stop offset="1" stop-color="#b06bff"/></linearGradient>
<linearGradient id="${id}-field" x1="32" y1="4" x2="32" y2="60" gradientUnits="userSpaceOnUse"><stop stop-color="#1e4685"/><stop offset=".55" stop-color="#122b5e"/><stop offset="1" stop-color="#091735"/></linearGradient>
<linearGradient id="${id}-mark" x1="32" y1="16" x2="32" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#c6dcff"/></linearGradient>
<linearGradient id="${id}-gloss" x1="32" y1="4" x2="32" y2="30" gradientUnits="userSpaceOnUse"><stop stop-color="#ffffff" stop-opacity=".3"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}-streak" x1="2" y1="0" x2="30" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#6fe0ff" stop-opacity="0"/><stop offset="1" stop-color="#6fe0ff" stop-opacity=".85"/></linearGradient>
<clipPath id="${id}-clip"><rect x="4" y="4" width="56" height="56" rx="17"/></clipPath>
</defs>
<rect x="1.5" y="1.5" width="61" height="61" rx="20" fill="url(#${id}-edge)"/>
<rect x="4" y="4" width="56" height="56" rx="17" fill="url(#${id}-field)"/>
<g clip-path="url(#${id}-clip)">
<rect x="-2" y="24.5" width="30" height="3.4" rx="1.7" fill="url(#${id}-streak)"/>
<rect x="-2" y="31.5" width="23" height="2.6" rx="1.3" fill="url(#${id}-streak)" opacity=".72"/>
<rect x="-2" y="38" width="17" height="2.2" rx="1.1" fill="url(#${id}-streak)" opacity=".45"/>
<rect x="4" y="4" width="56" height="25" fill="url(#${id}-gloss)"/>
<rect x="4" y="44" width="56" height="16" fill="#04102b" opacity=".22"/>
</g>
<path d="M19.5 44.5 25 19.5 32 38 39 19.5 44.5 44.5" fill="none" stroke="#04122e" stroke-opacity=".45" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 1.4)"/>
<path d="M19.5 44.5 25 19.5 32 38 39 19.5 44.5 44.5" fill="none" stroke="url(#${id}-mark)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
}

/** The same mark, ready to be handed to a `<link rel="icon">`. */
export function mochiroFaviconHref(): string {
  return `data:image/svg+xml,${encodeURIComponent(mochiroMarkSvg(64, 'fav'))}`
}
