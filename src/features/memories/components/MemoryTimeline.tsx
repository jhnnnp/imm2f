"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { createClient } from "@/lib/supabase/client";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createMemory } from "../actions";
import type { Memory, MemoryType } from "../types";
import type { Place } from "@/features/places/types/place";
import { formatKoDate, toIsoDate } from "@/lib/dates";

type MemoryTab = "timeline" | "album" | "map" | "trip" | "date";

export function MemoryTimeline({
  initialMemories,
  places,
  persist,
}: {
  initialMemories: Memory[];
  places: Place[];
  persist: boolean;
}) {
  const session = useAppSession();
  const [memories, setMemories] = useState(initialMemories);
  const [tab, setTab] = useState<MemoryTab>("timeline");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [happenedOn, setHappenedOn] = useState("");
  const [description, setDescription] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [viewer, setViewer] = useState<Memory | null>(null);
  const [memoryType, setMemoryType] = useState<MemoryType>("free");

  useEffect(() => {
    setHappenedOn(current => current || toIsoDate(new Date()));
  }, []);

  const sortedPlaces = useMemo(
    () => [...places].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [places],
  );
  const visible = useMemo(() => {
    if (tab === "trip") return memories.filter(item => item.memoryType === "trip");
    if (tab === "date") return memories.filter(item => item.memoryType === "date");
    return memories;
  }, [memories, tab]);
  const featured = visible[0] ?? null;
  const secondary = visible[1] ?? null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!persist) {
      setError("로그인 후 추억을 저장할 수 있어요.");
      return;
    }
    setPending(true);
    setError("");
    const selected = sortedPlaces.find(place => place.id === placeId);
    let photoUrl = coverUrl || selected?.image || "";
    const form = event.currentTarget;
    const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
    const file = fileInput?.files?.[0];
    if (file) {
      if (session.mode !== "authenticated") {
        setPending(false);
        setError("로그인 후 사진을 올릴 수 있어요.");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        setPending(false);
        setError("8MB 이하 이미지만 올릴 수 있어요.");
        return;
      }
      const supabase = createClient();
      if (!supabase) {
        setPending(false);
        setError("저장소를 아직 연결하지 않았어요.");
        return;
      }
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${session.coupleId}/${crypto.randomUUID()}.${ext}`;
      const uploaded = await supabase.storage.from("memory-photos").upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) {
        setPending(false);
        setError(uploaded.error.message);
        return;
      }
      photoUrl = supabase.storage.from("memory-photos").getPublicUrl(path).data.publicUrl;
    }
    const result = await createMemory({
      title,
      happenedOn,
      description,
      locationLabel: locationLabel || selected?.district || selected?.name || "",
      placeId: placeId || null,
      coverUrl: photoUrl,
      lng: selected?.coordinates?.[0] ?? null,
      lat: selected?.coordinates?.[1] ?? null,
      memoryType,
    });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setMemories(prev => [result.memory, ...prev]);
    setOpen(false);
    setTitle("");
    setDescription("");
    setLocationLabel("");
    setPlaceId("");
    setCoverUrl("");
    setFileName("");
  }

  function renderList(list: Memory[]) {
    if (!list.length) {
      return (
        <div className="empty-soft">
          <h1>이 보기에 추억이 없어요</h1>
          <p>남긴 장면이 있으면 Timeline · Album에서 다시 볼 수 있어요.</p>
          <button className="primary-button" type="button" onClick={() => setOpen(true)}>추억 남기기</button>
        </div>
      );
    }
    if (tab === "album") {
      return (
        <ul className="memory-album">
          {list.map(item => (
            <li key={item.id}>
              <button type="button" className="memory-album-open" onClick={() => setViewer(item)}>
                {item.coverUrl ? <img src={item.coverUrl} alt={item.title} /> : <div className="abstract-photo large">{item.locationLabel || item.title}</div>}
                <b>{item.title}</b>
                <small>{formatKoDate(item.happenedOn)}</small>
              </button>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="memory-wall">
        {featured && (
          <figure className="memory-main">
            <button type="button" className="memory-album-open" onClick={() => setViewer(featured)}>
              {featured.coverUrl
                ? <img src={featured.coverUrl} alt={featured.title} />
                : <div className="abstract-photo large">{featured.locationLabel || "memory"}</div>}
            </button>
            <figcaption>
              <span>{formatKoDate(featured.happenedOn)}{featured.locationLabel ? ` · ${featured.locationLabel}` : ""}</span>
              <h2>{featured.title}</h2>
              <p>{featured.description || "둘만 아는 그날의 장면."}</p>
            </figcaption>
          </figure>
        )}
        {secondary && (
          <figure className="memory-small taped">
            <button type="button" className="memory-album-open" onClick={() => setViewer(secondary)}>
              {secondary.coverUrl
                ? <img src={secondary.coverUrl} alt={secondary.title} />
                : <div className="abstract-photo large">{secondary.locationLabel || "memory"}</div>}
            </button>
            <figcaption>
              <span>{formatKoDate(secondary.happenedOn)}{secondary.locationLabel ? ` · ${secondary.locationLabel}` : ""}</span>
              <h3>{secondary.title}</h3>
            </figcaption>
          </figure>
        )}
        <div className="archive-count">
          <b>{list.length}</b>
          <span>memories<br />saved</span>
        </div>
        {list.length > 2 && (
          <ul className="memory-list">
            {list.slice(2).map(item => (
              <li key={item.id}>
                <button type="button" className="memory-list-open" onClick={() => setViewer(item)}>
                  <span>{formatKoDate(item.happenedOn)}</span>
                  <b>{item.title}</b>
                  <small>{item.locationLabel || item.description || "둘의 기록"}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">OUR ARCHIVE · {new Date().getFullYear()}</span>
          <h1>함께여서 기억나는 장면들</h1>
          <p>사진보다 먼저 떠오르는 마음까지 천천히 모아두었어요.</p>
        </div>
        <button className="date-action-button is-primary" type="button" onClick={() => setOpen(true)}><HeaderActionIcon name="plus" /><span>추억 남기기</span></button>
      </div>
      <div className="memory-tabs">
        {([
          ["timeline", "Timeline"],
          ["album", "Album"],
          ["map", "Map"],
          ["trip", "Trip"],
          ["date", "Date"],
        ] as const).map(([id, label]) => (
          <button className={tab === id ? "is-active" : ""} type="button" key={id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "map" ? (
        visible.filter(item => item.coordinates).length ? (
          <section className="memory-map-list paper-card">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">ON THE MAP</span>
                <h2>좌표가 있는 추억</h2>
              </div>
              <Link className="quiet-link" href="/our-map">Our Map 열기 →</Link>
            </div>
            <ul>
              {visible.filter(item => item.coordinates).map(item => (
                <li key={item.id}>
                  <Link href="/our-map">
                    <b>{item.title}</b>
                    <small>{formatKoDate(item.happenedOn)}{item.locationLabel ? ` · ${item.locationLabel}` : ""}</small>
                  </Link>
                </li>
              ))}
            </ul>
            {visible.some(item => !item.coordinates) && (
              <p className="form-hint">좌표가 없는 기록은 타임라인에서만 보여요. 장소를 연결하면 지도에도 올라갑니다.</p>
            )}
          </section>
        ) : (
          <div className="empty-soft">
            <h1>지도에 올릴 좌표가 없어요</h1>
            <p>추억을 남길 때 저장한 장소를 고르면 Our Map에 핀이 생겨요.</p>
            <div className="dialog-actions">
              <button className="primary-button" type="button" onClick={() => setOpen(true)}>추억 남기기</button>
              <Link className="outline-button" href="/our-map">Our Map 열기</Link>
            </div>
          </div>
        )
      ) : !memories.length ? (
        <div className="empty-soft">
          <h1>아직 남긴 추억이 없어요</h1>
          <p>다녀온 장소를 고르거나, 그날의 장면을 직접 적어 보세요.</p>
          <button className="primary-button" type="button" onClick={() => setOpen(true)}>첫 추억 남기기</button>
        </div>
      ) : renderList(visible)}

      {open && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !pending && setOpen(false)}>
          <form className="place-create-dialog memory-dialog" onClick={event => event.stopPropagation()} onSubmit={event => void submit(event)}>
            <div className="dialog-head">
              <div>
                <span className="eyebrow">NEW MEMORY</span>
                <h2>추억으로 남기기</h2>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={() => setOpen(false)}>×</button>
            </div>
            <label className="field">
              <span>제목</span>
              <input value={title} onChange={event => setTitle(event.target.value)} placeholder="계획 없이 걷던 토요일" required />
            </label>
            <label className="field">
              <span>날짜</span>
              <input type="date" value={happenedOn} onChange={event => setHappenedOn(event.target.value)} required />
            </label>
            <label className="field">
              <span>종류</span>
              <select value={memoryType} onChange={event => setMemoryType(event.target.value as MemoryType)}>
                <option value="free">그냥 그날</option>
                <option value="trip">여행</option>
                <option value="date">데이트</option>
              </select>
            </label>
            <label className="field">
              <span>연결된 장소</span>
              <select value={placeId} onChange={event => setPlaceId(event.target.value)}>
                <option value="">직접 적기</option>
                {sortedPlaces.map(place => (
                  <option key={place.id} value={place.id}>{place.name} · {place.district}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>장소 이름</span>
              <input value={locationLabel} onChange={event => setLocationLabel(event.target.value)} placeholder="성수 · 카페 골목" />
            </label>
            <label className="field">
              <span>짧은 기록</span>
              <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="정해둔 곳은 없었는데, 오래 기억할 장면은 많았다." rows={4} />
            </label>
            <label className="field file-field">
              <span>사진 올리기</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={event => setFileName(event.target.files?.[0]?.name ?? "")}
              />
              <small className="form-hint">{fileName || "선택하지 않으면 장소 사진이나 URL을 써요."}</small>
            </label>
            <label className="field">
              <span>또는 사진 URL</span>
              <input value={coverUrl} onChange={event => setCoverUrl(event.target.value)} placeholder="https://..." />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <p className="form-hint">사진은 둘만 보는 보관함에 올라가요. 8MB 이하 JPG, PNG, WEBP.</p>
            <div className="dialog-actions">
              <button className="outline-button" type="button" onClick={() => setOpen(false)} disabled={pending}>취소</button>
              <button className="primary-button" type="submit" disabled={pending}>{pending ? "저장 중..." : "추억 저장"}</button>
            </div>
          </form>
        </div>
      )}
      {viewer && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setViewer(null)}>
          <article className="memory-viewer" onClick={event => event.stopPropagation()}>
            {viewer.coverUrl ? <img src={viewer.coverUrl} alt={viewer.title} /> : <div className="abstract-photo large">{viewer.locationLabel || viewer.title}</div>}
            <div>
              <span>{formatKoDate(viewer.happenedOn)}{viewer.locationLabel ? ` · ${viewer.locationLabel}` : ""}</span>
              <h2>{viewer.title}</h2>
              <p>{viewer.description || "둘만 아는 그날의 장면."}</p>
              <button className="outline-button" type="button" onClick={() => setViewer(null)}>닫기</button>
            </div>
          </article>
        </div>
      )}
    </>
  );
}
