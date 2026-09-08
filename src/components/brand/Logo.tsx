/**
 * The Larimar mark.
 *
 * Two nested arcs form an L that also reads as a bridge span over water — the
 * "digital cash bridge" the brand promises. The arcs deliberately never close;
 * the negative space between them is the crossing.
 *
 * Drawn as live SVG rather than a raster asset so it stays sharp at any size,
 * inherits colour from context, and adds no network request.
 */

export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      role="img"
      aria-label="Larimar"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="10" className="fill-navy-900" />
      {/* Outer arc — the far bank */}
      <path
        d="M11 10v14.5c0 2.5 2 4.5 4.5 4.5H29"
        stroke="currentColor"
        className="text-larimar-400"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      {/* Inner arc — the span */}
      <path
        d="M17.5 10v9c0 2 1.6 3.6 3.6 3.6H29"
        stroke="currentColor"
        className="text-larimar-200"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

export function Logo({
  className = '',
  showWordmark = true,
  inverted = false,
}: {
  className?: string;
  showWordmark?: boolean;
  inverted?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-9 w-9 shrink-0" />
      {showWordmark ? (
        <span
          className={`text-lg font-bold tracking-[0.14em] ${inverted ? 'text-white' : 'text-navy-900'}`}
        >
          LARIMAR
        </span>
      ) : null}
    </span>
  );
}
