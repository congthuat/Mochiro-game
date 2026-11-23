// The zone book: every place a run can pass through, coloured in once the player has
// been there. The record lives on this device (zoneBook.ts); nothing goes to the server.

import { BookOpen, X } from 'lucide-react'
import { BIOMES, ZONE_ICONS } from '../../runner/config'
import { useT } from '../../lib/i18n'
import { visitedZones } from './zoneBook'

/** The menu button: the book's icon, its title and how much of it is filled in. */
export function ZoneBookEntry({ onOpen }: { onOpen: () => void }) {
  const t = useT()
  const seen = visitedZones()
  const total = BIOMES.length
  const found = BIOMES.filter((zone) => seen.has(zone.name)).length
  return (
    <button type="button" className="ar-book-entry" onClick={onOpen}>
      <span className="ar-book-entry-icon">
        <BookOpen size={18} />
      </span>
      <span className="ar-book-entry-text">
        <b>{t('book.button', { n: found, total })}</b>
        <span className="ar-book-entry-bar">
          <i style={{ width: `${Math.round((found / total) * 100)}%` }} />
        </span>
      </span>
      <span className="ar-book-entry-peek" aria-hidden>
        {BIOMES.filter((zone) => seen.has(zone.name))
          .slice(-3)
          .map((zone) => (
            <span key={zone.name}>{ZONE_ICONS[zone.name] ?? '🏁'}</span>
          ))}
      </span>
    </button>
  )
}

/** The book itself: one tile per zone, the unvisited ones greyed out behind a "?". */
export function RushZoneBook({ onClose }: { onClose: () => void }) {
  const t = useT()
  const seen = visitedZones()
  const total = BIOMES.length
  const found = BIOMES.filter((zone) => seen.has(zone.name)).length
  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ar-panel ar-modal ar-book">
        <div className="flex items-center justify-between">
          <div className="ar-modal-title">{t('book.title')}</div>
          <button className="ar-btn ar-btn-sm" onClick={onClose}>
            <X size={14} /> {t('book.close')}
          </button>
        </div>

        <div className="ar-book-progress">
          <span>{found === total ? t('book.complete') : t('book.progress', { n: found, total })}</span>
          <span className="ar-book-entry-bar">
            <i style={{ width: `${Math.round((found / total) * 100)}%` }} />
          </span>
        </div>
        <p className="ar-book-hint">{t('book.hint')}</p>

        <div className="ar-book-grid">
          {BIOMES.map((zone) => {
            const known = seen.has(zone.name)
            return (
              <div
                key={zone.name}
                className={known ? 'ar-book-tile is-known' : 'ar-book-tile'}
                style={known ? { background: `linear-gradient(165deg, ${zone.skyTop}, ${zone.sky} 58%, ${zone.ground})` } : undefined}
              >
                <span className="ar-book-tile-icon">{known ? (ZONE_ICONS[zone.name] ?? '🏁') : '?'}</span>
                <span className="ar-book-tile-name">{known ? t(`biome.${zone.name}`) : t('book.unknown')}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
