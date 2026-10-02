// The site's logo is served from the industry brand pack. Keep the site name as the accessible label
// and alt text while using the supplied image instead of repeating the text wordmark in the shell.
import { SITE } from "@aihot/industry/site";

export function Wordmark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center leading-none ${className}`} aria-label={SITE.name} role="img">
      <img src="/logo.png" alt={SITE.name} width={size} height={size} className="rounded-[22%] object-contain" />
    </span>
  );
}

/** A ring with a dot; spinning, it is the loader. */
export function RingMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g style={spinning ? { transformOrigin: "12px 12px", animation: "spin-slow 1.1s linear infinite" } : undefined}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="42 15" />
      </g>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}
