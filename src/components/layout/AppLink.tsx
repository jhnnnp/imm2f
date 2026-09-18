"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

export function AppLink(props: ComponentProps<typeof Link>) {
  return <Link prefetch={false} {...props} />;
}
