import type { PlaceCategoryId } from "../types/place";

const paths: Record<PlaceCategoryId, React.ReactNode> = {
  restaurant: <><path d="M4 3v7a3 3 0 0 0 3 3V3M4 7h3M11 3v18M17 3c2 2 3 4.5 3 7.5V13h-5v-2.5C15 7 15.7 4.5 17 3Zm0 10v8" /></>,
  cafe: <><path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" /><path d="M16 10h2a3 3 0 0 1 0 6h-3M7 3.5c0 1 1 1.5 1 2.5M11 3.5c0 1 1 1.5 1 2.5" /></>,
  tourist: <><path d="m3 19 6.5-12 4 7 2-3 5.5 8H3Z" /><path d="m8 10 1.5 1.5L11 10" /></>,
  nature: <><path d="M19.5 4.5C12 4.5 6 8.5 6 14a5.5 5.5 0 0 0 5.5 5.5c5.5 0 8-6 8-15Z" /><path d="M4 21c2.5-5 6-8.5 11-11" /></>,
  festival: <><path d="m12 3 1.3 4.1 4.2 1.4-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.4L12 3Z" /><path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14ZM5 14l.7 1.8 1.8.7-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14Z" /></>,
  stay: <><path d="M3 19V8M21 19v-7a3 3 0 0 0-3-3H9v7M3 16h18M6 9h3v4H6a2 2 0 0 1 0-4Z" /></>,
  photo: <><path d="M4 7h4l1.5-2h5L16 7h4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="4" /></>,
  book: <><path d="M4 4h5a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4V4ZM20 4h-5a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h5V4Z" /></>,
};

export function PlaceCategoryIcon({ category }: { category: PlaceCategoryId }) {
  return <svg className="place-category-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{paths[category]}</svg>;
}
