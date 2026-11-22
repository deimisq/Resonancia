// Mirrors public/logo.svg; kept inline so it renders instantly and scales with className.
export function Logo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Resonancia">
      <defs>
        <linearGradient id="rs-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#rs-g)" />
      <circle cx="32" cy="32" r="4.5" fill="#fff" />
      <g fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
        <path d="M24.29 22.81A12 12 0 0 0 24.29 41.19" />
        <path d="M39.71 22.81A12 12 0 0 1 39.71 41.19" />
        <path d="M19.14 16.68A20 20 0 0 0 19.14 47.32" opacity=".6" />
        <path d="M44.86 16.68A20 20 0 0 1 44.86 47.32" opacity=".6" />
      </g>
    </svg>
  );
}
