type SidebarIconName =
  | "home"
  | "date"
  | "trip"
  | "calendar"
  | "places"
  | "map"
  | "memories"
  | "vault"
  | "gifts"
  | "bucket"
  | "insights";

const paths: Record<SidebarIconName, React.ReactNode> = {
  home: <><path d="M3.5 10.5 12 3l8.5 7.5"/><path d="M5.7 9v11h12.6V9M9.2 20v-6.2h5.6V20"/></>,
  date: <><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M12 7.5v5l3.4 2"/></>,
  trip: <><path d="M4 19h16M7 19V8.2A2.2 2.2 0 0 1 9.2 6h5.6A2.2 2.2 0 0 1 17 8.2V19M9.5 6V4h5v2M8.5 11.5h7"/></>,
  calendar: <><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/></>,
  places: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.3"/></>,
  map: <><path d="m3.5 6 5-2.5 7 2.5 5-2.5v14l-5 2.5-7-2.5-5 2.5V6Z"/><path d="M8.5 3.5v14M15.5 6v14"/></>,
  memories: <><rect x="4" y="3.5" width="16" height="17" rx="2.5"/><circle cx="9" cy="9" r="1.5"/><path d="m5.5 17 4.3-4.3 3 3 2.2-2.2 3.5 3.5"/></>,
  vault: <><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><circle cx="12" cy="12" r="3"/><path d="M12 9v6M9 12h6M7 4V2.8M17 4V2.8"/></>,
  gifts: <><path d="M3.5 9h17v11h-17zM2.5 6h19v3h-19zM12 6v14"/><path d="M12 6H8.8A2.3 2.3 0 1 1 11 3.1L12 6Zm0 0h3.2A2.3 2.3 0 1 0 13 3.1L12 6Z"/></>,
  bucket: <><path d="M6 9.5V6a6 6 0 0 1 12 0v3.5M4 8h16l-1 13H5L4 8Z"/><path d="M9 12v4M15 12v4"/></>,
  insights: <><path d="M5 19V9M12 19V4M19 19v-7"/><path d="m3.5 7.5 6-3 5 4 6-4.5"/></>,
};

export function SidebarIcon({ name }: { name: SidebarIconName }) {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-symbol" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect className="brand-symbol-bg" x="1" y="1" width="46" height="46" rx="14" />
      <circle className="brand-symbol-ring brand-symbol-ring-left" cx="20" cy="24" r="8.25" />
      <circle className="brand-symbol-ring brand-symbol-ring-right" cx="28" cy="24" r="8.25" />
      <path className="brand-symbol-link" d="M24 17.35c2.72 1.47 4.25 3.7 4.25 6.65S26.72 29.18 24 30.65C21.28 29.18 19.75 26.95 19.75 24S21.28 18.82 24 17.35Z" />
      <path className="brand-symbol-spark" d="M35.6 11.2v4.4M33.4 13.4h4.4" />
      <circle className="brand-symbol-dot" cx="13.2" cy="35.2" r="1.15" />
    </svg>
  );
}
