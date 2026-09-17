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
  date: <><path d="M12 20.2S4.2 15.7 4.2 9.5a4.2 4.2 0 0 1 7.8-2.2 4.2 4.2 0 0 1 7.8 2.2c0 6.2-7.8 10.7-7.8 10.7Z"/><path d="M18.2 3.2v3.2M16.6 4.8h3.2"/></>,
  trip: <><rect x="4" y="7" width="16" height="12.5" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M8 7v12.5M16 7v12.5M4 12h16"/><path d="M7 22h.01M17 22h.01"/></>,
  calendar: <><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/></>,
  places: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.3"/></>,
  map: <><path d="m3.5 6 5-2.5 7 2.5 5-2.5v14l-5 2.5-7-2.5-5 2.5V6Z"/><path d="M8.5 3.5v14M15.5 6v14"/></>,
  memories: <><rect x="5" y="3.5" width="15" height="16" rx="2.3"/><path d="M5 7H3.8A1.8 1.8 0 0 0 2 8.8v10.4A1.8 1.8 0 0 0 3.8 21H16a2 2 0 0 0 2-1.5"/><circle cx="10" cy="8.5" r="1.4"/><path d="m6.5 16 3.7-3.8 2.7 2.6 2-2 3.6 3.2"/></>,
  vault: <><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="12" r="4"/><path d="M12 8v2.2M15.8 12H14M12 15.8V14M8.2 12H10M17.5 6.5h.01M17.5 17.5h.01"/></>,
  gifts: <><path d="M3.5 9h17v11h-17zM2.5 6h19v3h-19zM12 6v14"/><path d="M12 6H8.8A2.3 2.3 0 1 1 11 3.1L12 6Zm0 0h3.2A2.3 2.3 0 1 0 13 3.1L12 6Z"/></>,
  bucket: <><rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="m7.5 9 1.4 1.4 2.5-2.8M7.5 15l1.4 1.4 2.5-2.8M13.5 9h3M13.5 15h3"/></>,
  insights: <><path d="M12 3.5a7.5 7.5 0 0 0-4.4 13.6c.8.6 1.2 1.2 1.3 2h6.2c.1-.8.5-1.4 1.3-2A7.5 7.5 0 0 0 12 3.5Z"/><path d="M9 22h6M9.5 13.5l2-2 1.7 1.7 2.3-3"/></>,
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
