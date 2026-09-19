"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, type ComponentProps, type FocusEvent, type MouseEvent } from "react";

type PrefetchMode = "never" | "hover";

export function AppLink({
  prefetchMode = "hover",
  onMouseEnter,
  onFocus,
  href,
  ...props
}: ComponentProps<typeof Link> & { prefetchMode?: PrefetchMode }) {
  const router = useRouter();
  const warm = useCallback(() => {
    if (prefetchMode !== "hover" || typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return;
    router.prefetch(href);
  }, [href, prefetchMode, router]);

  return (
    <Link
      href={href}
      prefetch={prefetchMode === "never" ? false : undefined}
      {...props}
      onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) => {
        warm();
        onMouseEnter?.(event);
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        warm();
        onFocus?.(event);
      }}
    />
  );
}
