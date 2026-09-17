import type { PlaceCategoryId } from "../types/place";

const outlinePaths: Record<PlaceCategoryId, React.ReactNode> = {
  restaurant: (
    <>
      <path d="M6 3v7a2.5 2.5 0 0 0 5 0V3M8.5 3v7" />
      <path d="M16 4v16M19 4c-2 2.5-2.5 4.5-2.5 7V20" />
    </>
  ),
  cafe: (
    <>
      <path d="M5 9h11a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z" />
      <path d="M16 10h1.8a2.8 2.8 0 0 1 0 5.6H16M8 5v2M11 4.5v2.5" />
    </>
  ),
  tourist: (
    <>
      <path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  nature: (
    <>
      <path d="M12 21c-4-3.5-6.5-7-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 14 16 17.5 12 21Z" />
      <path d="M12 21V10" />
    </>
  ),
  festival: (
    <>
      <path d="m12 4 1.2 3.6 3.8 1.2-3.8 1.2L12 14l-1.2-3.8-3.8-1.2 3.8-1.2L12 4Z" />
      <path d="M5 16 6 19l-3 1 1-3ZM19 16l1 3 3-1-1-3Z" />
    </>
  ),
  stay: (
    <>
      <path d="M4 18V9a2 2 0 0 1 2-2h4v11M4 14h16M20 18V11a2 2 0 0 0-2-2h-4v9" />
      <path d="M8 11h2v3H8z" />
    </>
  ),
  photo: (
    <>
      <path d="M5 8h3l1.5-2h5L15 8h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  book: (
    <>
      <path d="M5 5h4.5a2.5 2.5 0 0 1 2.5 2.5V19a3 3 0 0 0-3-3H5V5Z" />
      <path d="M19 5h-4.5a2.5 2.5 0 0 0-2.5 2.5V19a3 3 0 0 1 3-3H19V5Z" />
    </>
  ),
};

const markPaths: Record<PlaceCategoryId, React.ReactNode> = {
  restaurant: (
    <>
      <circle cx="8" cy="12" r="5.5" fill="currentColor" opacity=".18" />
      <path
        d="M7 5.5v5.8M5.6 5.5v3.6a1.4 1.4 0 0 0 2.8 0V5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16.5 6v11.5M19 6c-1.6 2-2.2 3.8-2.2 6v5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  cafe: (
    <>
      <path
        d="M6.5 10h9.2a3.6 3.6 0 0 1 0 7.2H10a3.6 3.6 0 0 1-3.5-3.6V10Z"
        fill="currentColor"
        opacity=".2"
      />
      <path
        d="M6.5 10h9.2a3.6 3.6 0 0 1-3.6 3.6H10A3.6 3.6 0 0 1 6.5 10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M16.2 11.2h1.5a2.4 2.4 0 0 1 0 4.8h-1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8.2 6.5c0 .8.6 1.2 1.2 1.2M11.2 5.8c0 .8.6 1.2 1.2 1.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  tourist: (
    <>
      <path
        d="M12 20.5s6.5-4.2 6.5-10.3a6.5 6.5 0 1 0-13 0c0 6.1 6.5 10.3 6.5 10.3Z"
        fill="currentColor"
        opacity=".2"
      />
      <path
        d="M12 20.5s6.5-4.2 6.5-10.3a6.5 6.5 0 1 0-13 0c0 6.1 6.5 10.3 6.5 10.3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10.2" r="2.2" fill="currentColor" />
    </>
  ),
  nature: (
    <>
      <path
        d="M12 20.5c-3.8-3.2-6-6.6-6-9.8a6 6 0 1 1 12 0c0 3.2-2.2 6.6-6 9.8Z"
        fill="currentColor"
        opacity=".2"
      />
      <path
        d="M12 20.5V9.5M9.2 14.2c1.2-1.8 2.8-2.7 2.8-2.7s1.6.9 2.8 2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  festival: (
    <>
      <path
        d="m12 5.5 1.4 4 4 1.4-4 1.4-1.4 4-1.4-4-4-1.4 4-1.4 1.4-4Z"
        fill="currentColor"
        opacity=".22"
      />
      <path
        d="m12 5.5 1.4 4 4 1.4-4 1.4-1.4 4-1.4-4-4-1.4 4-1.4 1.4-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="17" r="1.2" fill="currentColor" />
      <circle cx="18.5" cy="16" r="1" fill="currentColor" />
    </>
  ),
  stay: (
    <>
      <path d="M4.5 18V10.5A2 2 0 0 1 6.5 8.5h4.5V18" fill="currentColor" opacity=".2" />
      <path d="M19.5 18V12a2 2 0 0 0-2-2h-4.5V18" fill="currentColor" opacity=".16" />
      <path
        d="M4.5 14.5h15M4.5 18h15M6.5 11h2.2v3.5H6.5a1 1 0 0 1-1-1v-1.5a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  photo: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="2.5" fill="currentColor" opacity=".18" />
      <path
        d="M4.5 8h4l1.6-2.2h5.8L17.5 8h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.5" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="13.5" r="1.2" fill="currentColor" />
    </>
  ),
  book: (
    <>
      <path d="M5.5 6.5h4.2a2.2 2.2 0 0 1 2.2 2.2V18a2.8 2.8 0 0 0-2.8-2.8H5.5V6.5Z" fill="currentColor" opacity=".2" />
      <path d="M18.5 6.5h-4.2a2.2 2.2 0 0 0-2.2 2.2V18a2.8 2.8 0 0 1 2.8-2.8h3.6V6.5Z" fill="currentColor" opacity=".16" />
      <path
        d="M5.5 6.5h4.2a2.2 2.2 0 0 1 2.2 2.2V18a2.8 2.8 0 0 0-2.8-2.8H5.5V6.5ZM18.5 6.5h-4.2a2.2 2.2 0 0 0-2.2 2.2V18a2.8 2.8 0 0 1 2.8-2.8h3.6V6.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </>
  ),
};

export function PlaceCategoryIcon({
  category,
  variant = "outline",
}: {
  category: PlaceCategoryId;
  variant?: "outline" | "mark";
}) {
  const className =
    variant === "mark" ? "place-category-icon place-category-icon--mark" : "place-category-icon";

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {variant === "mark" ? markPaths[category] : outlinePaths[category]}
    </svg>
  );
}
