import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/features/auth/types";
import type { Database } from "./database.types";

type WorkspaceReadContext = {
  client?: Promise<SupabaseClient<Database> | null>;
  session?: Promise<AppSession>;
};

const reads = new AsyncLocalStorage<WorkspaceReadContext>();

export function getWorkspaceReadContext() { return reads.getStore(); }

/** Server Actions lack React render memoization; scope their fan-out explicitly. */
export function withWorkspaceRead<T>(read: () => Promise<T>) {
  return reads.run({}, read);
}
