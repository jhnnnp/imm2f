"use client";

import { AppLink as Link } from "@/components/layout/AppLink";
import { useResolvedMemories } from "@/features/memories/resolvePhotoUrls";
import type { Memory } from "@/features/memories/types";
import { formatKoDate, formatKoShort } from "@/lib/dates";

function memoryCover(memory: Memory) {
  if (memory.coverUrl) return { kind: "image" as const, src: memory.coverUrl };
  const photo = memory.photos.find(item => item.storageUrl)?.storageUrl;
  if (photo) return { kind: "image" as const, src: photo };
  return { kind: "letter" as const };
}

export function HomeRecentMemory({ memories }: { memories: Memory[] }) {
  const memory = useResolvedMemories(memories)[0] ?? null;
  const cover = memory ? memoryCover(memory) : null;

  return (
    <section className="recent-memory paper-card">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">RECENT MEMORY</span>
          <h2>가장 가까운 장면</h2>
        </div>
        <Link className="quiet-link" href="/memories">{memory ? "열어보기 →" : "남기러 가기 →"}</Link>
      </div>
      {memory && cover ? (
        <Link className="memory-postcard" href="/memories">
          <span className="memory-postcard-frame">
            <span className="memory-postcard-media">
              {cover.kind === "image" ? <img src={cover.src} alt="" loading="lazy" decoding="async" /> : (
                <span className="memory-letter">
                  <b>{memory.happenedOn ? formatKoShort(memory.happenedOn) : "our day"}</b>
                  <small>{memory.locationLabel || "우리가 아는 장면"}</small>
                </span>
              )}
            </span>
          </span>
          <span className="memory-postcard-copy">
            <b>{memory.title}</b>
            <em>{memory.description || "우리가 아는 그날의 장면."}</em>
            <small>{memory.happenedOn ? formatKoDate(memory.happenedOn) : ""}{memory.locationLabel ? ` · ${memory.locationLabel}` : ""}</small>
          </span>
        </Link>
      ) : (
        <p className="form-hint">다녀온 날을 짧게 적어두면, 홈에서 다시 만나요.</p>
      )}
    </section>
  );
}
