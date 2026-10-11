import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = join(process.cwd(), "supabase/migrations");
const migrations = readdirSync(migrationDirectory).filter(name => name.endsWith(".sql")).sort()
  .map(name => ({ name, sql: readFileSync(join(migrationDirectory, name), "utf8") }));
const initial = migrations.find(file => file.name.endsWith("_shared_trip_date_drafts.sql"))!.sql;
const followup = migrations.find(file => file.name.endsWith("_preserve_unchanged_trip_snapshots.sql"))!.sql;
const restrictedWrites = migrations.find(file => file.name.endsWith("_restrict_plan_writes_to_atomic_rpcs.sql"))!.sql;
const rpcNames = ["save_couple_plan_atomic", "reschedule_couple_trip"];

// Model routine identity across the migration chain. PostgreSQL keeps overloads
// when argument types change; CREATE OR REPLACE alone cannot retire an old RPC.
function finalRpcSignatures() {
  const routines = new Map<string, { name: string; parameters: string[] }>();
  for (const { sql } of migrations) {
    const statements = sql.matchAll(/\b(create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?)\s+public\.(save_couple_plan_atomic|reschedule_couple_trip)\s*\(([^)]*)\)/gi);
    for (const match of statements) {
      const dropping = match[1].toLowerCase().startsWith("drop");
      const parameters = match[3].split(",").map(parameter => {
        const words = parameter.trim().toLowerCase().split(/\s+/);
        return dropping ? words[0] : words[1];
      });
      const key = `${match[2]}(${parameters.join(",")})`;
      if (dropping) routines.delete(key);
      else routines.set(key, { name: match[2], parameters });
    }
  }
  return [...routines.values()];
}

function newRpcBody(name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = followup.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${escapedName}\\([\\s\\S]*?as\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1`, "i"));
  if (!match) throw new Error(`Missing guarded RPC: ${name}`);
  return match[2].toLowerCase();
}

describe("trip date migration security contracts", () => {
  it("retires old overloads so default and named calls reach only guarded RPCs", () => {
    const signatures = finalRpcSignatures();
    expect(signatures.filter(routine => routine.name === rpcNames[0]).map(routine => routine.parameters))
      .toEqual([["text", "text", "text", "date", "integer", "jsonb", "text", "bigint", "uuid"]]);
    expect(signatures.filter(routine => routine.name === rpcNames[1]).map(routine => routine.parameters))
      .toEqual([["date", "bigint", "timestamptz", "uuid"]]);
    expect(followup).toMatch(/expected_couple_id\s+uuid\s+default\s+null/gi);
  });

  it.each(finalRpcSignatures())("denies anonymous execution of $name while granting authenticated callers", ({ name, parameters }) => {
    const signature = `${name}\\(${parameters.join(",")}\\)`;
    expect(followup).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+public,\\s*anon`, "i"));
    expect(followup).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+to\\s+authenticated`, "i"));
  });

  it.each(rpcNames)("serializes %s with invite acceptance and revalidates workspace before plan locks", name => {
    const body = newRpcBody(name);
    const profileLock = body.indexOf("from public.profiles where id = uid for no key update");
    const currentWorkspace = body.indexOf("cid is distinct from public.my_couple_id()");
    const expectedWorkspace = body.indexOf("expected_couple_id is distinct from cid");
    const rejection = body.indexOf("raise exception 'workspace_changed'");
    const planLock = body.indexOf("pg_advisory_xact_lock");
    expect(profileLock).toBeGreaterThan(-1);
    expect(currentWorkspace).toBeGreaterThan(profileLock);
    expect(expectedWorkspace).toBeGreaterThan(profileLock);
    expect(rejection).toBeGreaterThan(expectedWorkspace);
    expect(planLock).toBeGreaterThan(rejection);
  });

  it("keeps undated snapshots unique and accessible only to their couple", () => {
    expect(initial).toMatch(/unique\s+nulls\s+not\s+distinct\s*\(couple_id,\s*scheduled_on\)/i);
    expect(initial).toMatch(/references\s+public\.couples\(id\)\s+on\s+delete\s+cascade/i);
    expect(initial).toMatch(/enable\s+row\s+level\s+security/i);
    expect(initial).toMatch(/using\s*\(couple_id\s*=\s*\(select\s+public\.my_couple_id\(\)\)\)/i);
    expect(initial).toMatch(/revoke\s+all\s+on\s+public\.trip_drafts\s+from\s+public,\s*anon,\s*authenticated/i);
    const authenticatedGrants = [...initial.matchAll(/grant\s+([^;]+)\s+on\s+public\.trip_drafts\s+to\s+authenticated/gi)];
    expect(authenticatedGrants.map(match => match[1].trim().toLowerCase())).toEqual(["select"]);
    expect(initial).toMatch(/trip_drafts\s+replica\s+identity\s+full/i);
    expect(initial).toMatch(/alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.trip_drafts/i);
  });

  it("permits only coordinate hydration as a direct authenticated write", () => {
    expect(restrictedWrites).toMatch(/revoke\s+all\s+on\s+public\.plans,\s*public\.plan_items\s+from\s+public,\s*anon,\s*authenticated/i);
    expect(restrictedWrites).toMatch(/grant\s+select\s+on\s+public\.plans,\s*public\.plan_items\s+to\s+authenticated/i);
    const directWrites = [...restrictedWrites.matchAll(/grant\s+(insert|update|delete|all)([^;]*)\s+to\s+authenticated/gi)];
    expect(directWrites.map(match => `${match[1]}${match[2]}`.replace(/\s+/g, " ").trim().toLowerCase()))
      .toEqual(["update (lng, lat) on public.plan_items"]);
    expect(restrictedWrites).toMatch(/grant\s+all\s+on\s+public\.plans,\s*public\.plan_items\s+to\s+service_role/i);
    expect(restrictedWrites).not.toMatch(/disable\s+row\s+level\s+security|drop\s+policy/i);
  });

  it("does not regenerate an unchanged snapshot's overwrite confirmation token", () => {
    const upserts = [...followup.matchAll(/on\s+conflict\s*\(couple_id,\s*scheduled_on\)\s+do\s+update\s+([\s\S]*?);/gi)];
    expect(upserts).toHaveLength(2);
    for (const [, update] of upserts) {
      expect(update).toMatch(/where\s+\(public\.trip_drafts\.title,\s*public\.trip_drafts\.notes,\s*public\.trip_drafts\.day_count,\s*public\.trip_drafts\.items\)\s+is\s+distinct\s+from\s+\(excluded\.title,\s*excluded\.notes,\s*excluded\.day_count,\s*excluded\.items\)/i);
    }
  });
});
