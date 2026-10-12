"use client";

import { useLinkStatus } from "next/link";
import styles from "./NavigationProgress.module.css";

export function NavigationProgress({ pendingOverride = false }: { pendingOverride?: boolean }) {
  const { pending: linkPending } = useLinkStatus();
  const pending = linkPending || pendingOverride;
  return <>
    <span className={styles.state} data-navigation-pending={pending} aria-hidden="true" />
    {pending && <><span className="nav-progress" aria-hidden="true" /><span className="sr-only" role="status">페이지를 불러오고 있어요.</span></>}
  </>;
}
