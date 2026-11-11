// The mark itself lives in src/runner/mochiro.ts, so that non-React callers (the tab
// icon, the check scripts) can build it without pulling in the component runtime.
import { mochiroMarkSvg } from '../../runner/mochiro'

export function MochiroLogo({ size = 54, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`ar-mark ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: mochiroMarkSvg(size) }}
    />
  )
}
