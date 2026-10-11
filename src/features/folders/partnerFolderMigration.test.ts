import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "supabase/migrations");
const file = readdirSync(migrationDirectory).find(name => name.endsWith("_preserve_folders_on_partner_connect.sql"))!;
const sql = readFileSync(resolve(migrationDirectory, file), "utf8");
const original = readFileSync(resolve(migrationDirectory, "20261011033654_protect_invite_workspace.sql"), "utf8");

function acceptFunction(source: string) {
  const match = source.match(/create or replace function public\.accept_couple_invite\(invite_token text\)[\s\S]*?\$\$;/);
  if (!match) throw new Error("Expected the existing invitation-acceptance function");
  return match[0];
}

describe("folders remain protected during partner connection", () => {
  it("preserves all existing auth, locking, invitation validation and replay behavior", () => {
    const replacement = acceptFunction(sql);
    expect(replacement.replace("      or exists (select 1 from public.couple_folders where couple_id = existing)\n", "")).toBe(acceptFunction(original));
  });

  it("treats empty folders in either scope as saved data before removing current membership", () => {
    const folderGuard = "or exists (select 1 from public.couple_folders where couple_id = existing)";
    const guardAt = sql.indexOf(folderGuard);
    const rejectAt = sql.indexOf("raise exception 'solo workspace has saved data'", guardAt);
    const leaveAt = sql.indexOf("delete from public.couple_members where user_id = uid and couple_id = existing");
    expect(guardAt).toBeGreaterThan(sql.indexOf("perform 1 from public.date_drafts where couple_id = existing for update"));
    expect(rejectAt).toBeGreaterThan(guardAt);
    expect(leaveAt).toBeGreaterThan(rejectAt);
    // Requiring a membership row or a specific folder scope would miss a newly
    // named empty vault/place folder and allow the account to lose access.
    expect(folderGuard).not.toContain("scope");
    expect(sql).not.toMatch(/(?:delete from|drop table)\s+public\.(?:couple_folders|couple_folder_items|couples)\b/i);
  });

  it("replaces only acceptance and retains the authenticated-only invocation permissions", () => {
    expect(sql.match(/create or replace function/g)).toHaveLength(1);
    expect(sql).toContain("revoke execute on function public.accept_couple_invite(text) from public, anon;");
    expect(sql).toContain("grant execute on function public.accept_couple_invite(text) to authenticated;");
    expect(sql).not.toMatch(/grant execute[\s\S]*?\bto\s+(?:public|anon)\b/i);
    expect(sql).toContain("set local lock_timeout = '5s';");
  });

  it("runs after the folder tables have been introduced", () => {
    const creation = readdirSync(migrationDirectory).find(name => name.endsWith("_shared_archive_folders.sql"))!;
    expect(file.localeCompare(creation)).toBeGreaterThan(0);
  });
});
