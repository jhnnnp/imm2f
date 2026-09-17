export type HeaderActionIconName = "sparkles" | "plus" | "activity" | "edit" | "search" | "archive";

const paths: Record<HeaderActionIconName, React.ReactNode> = {
  sparkles: <><path d="m12 3 1.1 3.4L16.5 7.5l-3.4 1.1L12 12l-1.1-3.4-3.4-1.1 3.4-1.1L12 3Z"/><path d="m18.5 13 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3ZM5.5 14l.8 2.7 2.7.8-2.7.8L5.5 21l-.8-2.7-2.7-.8 2.7-.8.8-2.7Z"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  activity: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/><path d="m3.5 7.5 6-3 5 4 6-4.5"/></>,
  edit: <><path d="M13.5 5.5 18.5 10.5M4 20l1.2-5.2L16.8 3.2a1.7 1.7 0 0 1 2.4 0l1.6 1.6a1.7 1.7 0 0 1 0 2.4L9.2 18.8 4 20Z"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
  archive: <><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M2.5 3.5h19v4h-19zM9 12h6"/></>,
};

export function HeaderActionIcon({ name }: { name: HeaderActionIconName }) {
  return <svg className="date-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{paths[name]}</svg>;
}
