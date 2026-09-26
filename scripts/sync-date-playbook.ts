import { loadEnvConfig } from "@next/env";
import { DATE_PLAYBOOK } from "../src/lib/openai/datePlaybook";
import { getSupabaseSecretKey, getSupabaseUrl } from "../src/lib/supabase/env";
import { createServiceClient } from "../src/lib/supabase/server";
import { embedPlaybookTexts } from "../src/lib/openai/datePlaybookSemantic";

loadEnvConfig(process.cwd());

async function main() {
  if (!getSupabaseUrl() || !getSupabaseSecretKey()) throw new Error("Supabase service credentials are required");
  const client = createServiceClient();
  if (!client) throw new Error("Supabase service client unavailable");
  const ids = DATE_PLAYBOOK.map(card => card.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate playbook ID");
  for (const card of DATE_PLAYBOOK) {
    if (card.requiredTags?.some(tag => !card.tags.includes(tag) && tag !== "cultural_event")) {
      throw new Error(`Unindexed required tag in ${card.id}`);
    }
  }
  const vectors = await embedPlaybookTexts(DATE_PLAYBOOK.map(card => `${card.title}. ${card.guidance} ${card.example}`), 20000);
  if (!vectors) throw new Error("Playbook embedding generation failed");
  const rows = DATE_PLAYBOOK.map(({ requiredTags, excludedTags, ...card }, index) => ({ ...card,
    required_tags: requiredTags ?? [], excluded_tags: excludedTags ?? [], updated_at: new Date().toISOString(),
    embedding: JSON.stringify(vectors[index]), embedding_model: "text-embedding-3-small:512" }));
  const { error } = await client.from("date_planning_playbook").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`Playbook sync failed: ${error.code}`);
  const { data, error: readError } = await client.from("date_planning_playbook")
    .select("id,version,active,required_tags,excluded_tags,embedding_model").in("id", ids);
  if (readError || !data || data.length !== ids.length
    || data.some(row => {
      const card = DATE_PLAYBOOK.find(card => card.id === row.id);
      return !card || row.version !== card.version || row.active !== card.active || row.embedding_model !== "text-embedding-3-small:512"
        || JSON.stringify(row.required_tags) !== JSON.stringify(card.requiredTags ?? [])
        || JSON.stringify(row.excluded_tags) !== JSON.stringify(card.excludedTags ?? []);
    })) {
    throw new Error("Playbook verification failed");
  }
  console.info("date_playbook_synced", { cards: data.length, active: data.filter(row => row.active).length });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
