export function PlaceTripStampIcon({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
    >
      <path
        d="M8.5 8.5h7l1.4 3.2a1 1 0 0 1-.92 1.4H8.02a1 1 0 0 1-.92-1.4L8.5 8.5Z"
        fill="currentColor"
        opacity=".22"
      />
      <path
        d="M8.5 8.5h7l1.4 3.2a1 1 0 0 1-.92 1.4H8.02a1 1 0 0 1-.92-1.4L8.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.8 13.2v5.3a1.2 1.2 0 0 0 1.2 1.2h6a1.2 1.2 0 0 0 1.2-1.2v-5.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M10.2 13.2v3.2M13.8 13.2v3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17.2" cy="7.4" r="2.1" fill="#f4c9a8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M16.4 7.4h1.6M17.2 6.6v1.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function PlaceTripStamp({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`place-trip-stamp${compact ? " is-compact" : ""}`} title="여행 일정에 포함">
      <PlaceTripStampIcon size={compact ? 15 : 17} />
      {!compact ? <span>여행 중</span> : null}
    </span>
  );
}
