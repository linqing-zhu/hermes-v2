/**
 * Boss-horse workstation with the scarf/collar recolored to the node accent.
 * The source SVG (boss-horse-seated.svg) has a fixed orange collar and is loaded
 * as an <img>; rather than transcribe its ~40 paths to recolor one shape, we
 * overlay an SVG that redraws JUST the collar polygon (identical coordinates +
 * identical viewBox + matching preserveAspectRatio), so it lands exactly on top
 * of the orange collar at any scale.
 */
export function SeatedBoss({ accent, className }: { accent: string; className?: string }) {
  return (
    <div className={className} style={{ position: 'relative' }}>
      <img
        src="/avatars/boss-horse-seated.svg"
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', display: 'block' }}
      />
      <svg
        viewBox="-28 291 489 495"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <polygon points="172.8,468.8 276.3,467.5 277.7,495.7 167.8,496.4 169.1,468.3" fill={accent} />
      </svg>
    </div>
  )
}
