"use client";

import Link from "next/link";
import { NavigationProgress } from "./NavigationProgress";
import { useState, type ComponentProps, type FocusEvent, type MouseEvent, type TouchEvent } from "react";
import styles from "./NavigationProgress.module.css";

type PrefetchMode = "auto" | "never" | "hover" | "full";

export function AppLink({
  prefetchMode = "auto",
  onMouseEnter,
  onFocus,
  onTouchStart,
  className,
  href,
  prefetch,
  children,
  ...props
}: ComponentProps<typeof Link> & { prefetchMode?: PrefetchMode }) {
  const [intentHref, setIntentHref] = useState<typeof href>();
  // Main menus prepare the complete RSC payload and client code before a click.
  // Other links retain native shell/intent prefetch to bound background work.
  // Cache invalidation is asynchronous and never holds navigation open.
  const nativePrefetch = prefetchMode === "never"
    ? false
    : prefetch !== undefined
      ? prefetch
      : prefetchMode === "full"
        ? true
        : prefetchMode === "hover" && intentHref !== href ? false : null;
  const warm = () => {
    if (prefetchMode === "hover") setIntentHref(href);
  };

  return (
    <Link
      href={href}
      {...props}
      className={[className, styles.link].filter(Boolean).join(" ")}
      prefetch={nativePrefetch}
      onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) => {
        onMouseEnter?.(event);
        if (event.defaultPrevented) return;
        warm();
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(event);
        if (!event.defaultPrevented) warm();
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        onTouchStart?.(event);
        if (!event.defaultPrevented) warm();
      }}
    >
      {children}
      <NavigationProgress />
    </Link>
  );
}
