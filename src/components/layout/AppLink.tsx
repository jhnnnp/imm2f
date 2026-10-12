"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { NavigationProgress } from "./NavigationProgress";
import { useCallback, useEffect, useRef, useState, useTransition, type ComponentProps, type FocusEvent, type MouseEvent, type TouchEvent } from "react";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { appSessionIdentity } from "@/features/auth/types";
import { cancelPendingNavigation, needsFreshNavigation, prepareNavigation, trackPendingNavigation, waitForFreshNavigation } from "./navigationIntent";
import styles from "./NavigationProgress.module.css";

type PrefetchMode = "never" | "hover";

export function AppLink({
  prefetchMode = "hover",
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onTouchStart,
  onNavigate,
  className,
  href,
  prefetch,
  children,
  ...props
}: ComponentProps<typeof Link> & { prefetchMode?: PrefetchMode }) {
  const router = useRouter();
  const identity = appSessionIdentity(useAppSession());
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingNavigation = useRef<AbortController | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [transitionPending, startTransition] = useTransition();
  const cancelHover = useCallback(() => { clearTimeout(hoverTimer.current); hoverTimer.current = undefined; }, []);
  const warm = useCallback(() => {
    if (prefetchMode !== "hover" || prefetch === false || props.as || (props.target && props.target !== "_self") || (props.download != null && props.download !== false)) return;
    prepareNavigation(router, href, identity);
  }, [href, identity, prefetchMode, prefetch, props.as, props.target, props.download, router]);
  useEffect(() => cancelHover, [cancelHover, warm]);
  useEffect(() => {
    setPreparing(false);
    return () => {
      pendingNavigation.current?.abort();
      pendingNavigation.current = null;
    };
  }, [href, identity]);

  return (
    <Link
      href={href}
      {...props}
      className={[className, styles.link].filter(Boolean).join(" ")}
      aria-busy={preparing || transitionPending ? true : props["aria-busy"]}
      prefetch={prefetch ?? false}
      onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) => {
        onMouseEnter?.(event);
        if (event.defaultPrevented) return;
        cancelHover();
        hoverTimer.current = setTimeout(warm, 100);
      }}
      onMouseLeave={(event: MouseEvent<HTMLAnchorElement>) => {
        cancelHover();
        onMouseLeave?.(event);
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(event);
        if (!event.defaultPrevented) { cancelHover(); warm(); }
      }}
      onBlur={(event: FocusEvent<HTMLAnchorElement>) => {
        cancelHover();
        onBlur?.(event);
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        onTouchStart?.(event);
        if (!event.defaultPrevented) { cancelHover(); warm(); }
      }}
      onNavigate={event => {
        let cancelled = false;
        onNavigate?.({ preventDefault: () => { cancelled = true; event.preventDefault(); } });
        if (cancelled) return;
        cancelHover();
        if (pendingNavigation.current && !pendingNavigation.current.signal.aborted) {
          event.preventDefault();
          return;
        }
        cancelPendingNavigation();
        if (props.as || typeof href !== "string" || !needsFreshNavigation(href, identity)) return;
        event.preventDefault();
        const controller = new AbortController();
        const origin = window.location.href;
        const release = trackPendingNavigation(controller);
        pendingNavigation.current = controller;
        setPreparing(true);
        void waitForFreshNavigation(router, href, identity, controller.signal).then(result => {
          if (result === "cancelled" || controller.signal.aborted || latestIdentity.current !== identity || window.location.href !== origin) return;
          if (result === "reload") {
            if (props.replace) window.location.replace(href);
            else window.location.assign(href);
            return;
          }
          startTransition(() => {
            const options = { scroll: props.scroll, transitionTypes: props.transitionTypes };
            if (props.replace) router.replace(href, options);
            else router.push(href, options);
          });
        }).finally(() => {
          release();
          if (pendingNavigation.current === controller) {
            pendingNavigation.current = null;
            setPreparing(false);
          }
        });
      }}
    >
      {children}
      <NavigationProgress pendingOverride={preparing || transitionPending} />
    </Link>
  );
}
