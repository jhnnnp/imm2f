"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { createClient } from "@/lib/supabase/client";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createMemory, deleteMemory, updateMemory } from "../actions";
import type { Memory, MemoryType, PhotoMetadataInput } from "../types";
import type { Place } from "@/features/places/types/place";
import { formatKoDate, toIsoDate } from "@/lib/dates";

type MemoryTab = "timeline" | "album" | "map" | "trip" | "date";
type CreateStep = "photo" | "story";

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
  const [createStep, setCreateStep] = useState<CreateStep>("photo");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [happenedOn, setHappenedOn] = useState("");
  const [description, setDescription] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoMetadata, setPhotoMetadata] = useState<PhotoMetadataInput | null>(null);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [metadataPending, setMetadataPending] = useState(false);
  const [viewer, setViewer] = useState<Memory | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editLatitude, setEditLatitude] = useState("");
  const [editLongitude, setEditLongitude] = useState("");
  const [editType, setEditType] = useState<MemoryType>("free");
  const [memoryType, setMemoryType] = useState<MemoryType>("free");

  useEffect(() => {
    setHappenedOn(current => current || toIsoDate(new Date()));
  }, []);

  useEffect(() => () => {
    if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  async function inspectPhoto(file?: File) {
    setSelectedFile(file ?? null);
    setFileName(file?.name ?? "");
    setPhotoMetadata(null);
    setLatitude("");
    setLongitude("");
    if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : "");
    if (!file) return;
    setMetadataPending(true);
    try {
      const [{ parse }, bitmap] = await Promise.all([
        import("exifr"),
        createImageBitmap(file).catch(() => null),
      ]);
      const exif = await parse(file, [
        "DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude", "latitude", "longitude",
        "Make", "Model", "LensModel", "Orientation", "Software",
      ]).catch(() => null) as Record<string, unknown> | null;
      const lat = Number(exif?.latitude ?? exif?.GPSLatitude);
      const lng = Number(exif?.longitude ?? exif?.GPSLongitude);
      const captured = exif?.DateTimeOriginal ?? exif?.CreateDate;
      const capturedDate = captured instanceof Date ? captured : captured ? new Date(String(captured)) : null;
      const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
      if (hasCoordinates) {
        setLatitude(lat.toFixed(6));
        setLongitude(lng.toFixed(6));
        setLocationLabel(current => current || "사진의 촬영 위치");
      }
      if (capturedDate && !Number.isNaN(capturedDate.getTime())) setHappenedOn(toIsoDate(capturedDate));
      setPhotoMetadata({
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        width: bitmap?.width ?? null,
        height: bitmap?.height ?? null,
        capturedAt: capturedDate && !Number.isNaN(capturedDate.getTime()) ? capturedDate.toISOString() : null,
        latitude: hasCoordinates ? lat : null,
        longitude: hasCoordinates ? lng : null,
        cameraMake: String(exif?.Make ?? ""),
        cameraModel: String(exif?.Model ?? ""),
        orientation: Number.isFinite(Number(exif?.Orientation)) ? Number(exif?.Orientation) : null,
        locationSource: hasCoordinates ? "exif" : "none",
        metadata: {
          lens: String(exif?.LensModel ?? ""),
          software: String(exif?.Software ?? ""),
        },
      });
      bitmap?.close();
    } catch {
      setPhotoMetadata({ originalFilename: file.name, mimeType: file.type, fileSize: file.size });
    } finally {
      setMetadataPending(false);
    }
  }

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

  function openComposer() {
    setCreateStep("photo");
    setError("");
    setOpen(true);
  }

  function continueToStory() {
    setTitle(current => current || (locationLabel && locationLabel !== "사진의 촬영 위치" ? `${locationLabel}에서의 우리` : "우리의 하루"));
    setCreateStep("story");
  }

  function beginEdit(memory: Memory) {
    setEditTitle(memory.title);
    setEditDate(memory.happenedOn);
    setEditDescription(memory.description);
    setEditLocation(memory.locationLabel);
    setEditLongitude(memory.coordinates?.[0]?.toString() ?? "");
    setEditLatitude(memory.coordinates?.[1]?.toString() ?? "");
    setEditType(memory.memoryType);
    setError("");
    setEditing(true);
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!viewer) return;
    setPending(true);
    setError("");
    const lat = editLatitude.trim() ? Number(editLatitude) : null;
    const lng = editLongitude.trim() ? Number(editLongitude) : null;
    const result = await updateMemory({
      id: viewer.id,
      title: editTitle,
      happenedOn: editDate,
      description: editDescription,
      locationLabel: editLocation,
      memoryType: editType,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
    setPending(false);
    if ("error" in result) { setError(result.error); return; }
    setMemories(current => current.map(memory => memory.id === result.memory.id ? result.memory : memory));
    setViewer(result.memory);
    setEditing(false);
  }

  async function removeCurrentMemory() {
    if (!viewer || !window.confirm(`‘${viewer.title}’ 추억과 연결된 사진을 삭제할까요?`)) return;
    setPending(true);
    setError("");
    const result = await deleteMemory(viewer.id);
    setPending(false);
    if ("error" in result) { setError(result.error); return; }
    setMemories(current => current.filter(memory => memory.id !== viewer.id));
    setViewer(null);
    setEditing(false);
  }

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
    let uploadedPath: string | null = null;
    const file = selectedFile;
    if (file) {
      if (session.mode !== "authenticated") {
        setPending(false);
        setError("로그인 후 사진을 올릴 수 있어요.");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        setPending(false);
        setError("20MB 이하 이미지만 올릴 수 있어요.");
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
      uploadedPath = path;
      photoUrl = path;
    }
    const parsedLat = latitude.trim() ? Number(latitude) : null;
    const parsedLng = longitude.trim() ? Number(longitude) : null;
    const hasManualCoordinates = Number.isFinite(parsedLat) && Number.isFinite(parsedLng);
    const result = await createMemory({
      title,
      happenedOn,
      description,
      locationLabel: locationLabel || selected?.district || selected?.name || "",
      placeId: placeId || null,
      coverUrl: photoUrl,
      lng: selected?.coordinates?.[0] ?? (hasManualCoordinates ? parsedLng : null),
      lat: selected?.coordinates?.[1] ?? (hasManualCoordinates ? parsedLat : null),
      memoryType,
      photo: file ? {
        ...photoMetadata,
        storagePath: uploadedPath,
        latitude: selected?.coordinates?.[1] ?? (hasManualCoordinates ? parsedLat : photoMetadata?.latitude ?? null),
        longitude: selected?.coordinates?.[0] ?? (hasManualCoordinates ? parsedLng : photoMetadata?.longitude ?? null),
        locationSource: selected ? "place" : hasManualCoordinates
          ? photoMetadata?.locationSource === "exif" ? "exif" : "manual"
          : "none",
      } : undefined,
    });
    setPending(false);
    if ("error" in result) {
      if (uploadedPath && session.mode === "authenticated") {
        const supabase = createClient();
        await supabase?.storage.from("memory-photos").remove([uploadedPath]);
      }
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
    setSelectedFile(null);
    setPhotoPreview("");
    setPhotoMetadata(null);
    setLatitude("");
    setLongitude("");
  }

  function renderList(list: Memory[]) {
    if (!list.length) {
      return (
        <div className="empty-soft">
          <h1>이 보기에 추억이 없어요</h1>
          <p>남긴 장면이 있으면 Timeline · Album에서 다시 볼 수 있어요.</p>
          <button className="primary-button" type="button" onClick={openComposer}>추억 남기기</button>
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
        <button className="date-action-button is-primary" type="button" onClick={openComposer}><HeaderActionIcon name="plus" /><span>추억 남기기</span></button>
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
              <button className="primary-button" type="button" onClick={openComposer}>추억 남기기</button>
              <Link className="outline-button" href="/our-map">Our Map 열기</Link>
            </div>
          </div>
        )
      ) : !memories.length ? (
        <div className="empty-soft">
          <h1>아직 남긴 추억이 없어요</h1>
          <p>다녀온 장소를 고르거나, 그날의 장면을 직접 적어 보세요.</p>
          <button className="primary-button" type="button" onClick={openComposer}>첫 추억 남기기</button>
        </div>
      ) : renderList(visible)}

      {open && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !pending && setOpen(false)}>
          <form className="place-create-dialog memory-dialog" onClick={event => event.stopPropagation()} onSubmit={event => void submit(event)}>
            <div className="dialog-head">
              <div>
                <span className="eyebrow">NEW MEMORY · {createStep === "photo" ? "1 / 2" : "2 / 2"}</span>
                <h2>{createStep === "photo" ? "먼저, 오늘의 장면을 골라요" : "이 장면에 이름을 붙여요"}</h2>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="memory-step-track" aria-label="기억 만들기 진행 단계"><i className={createStep === "story" ? "is-complete" : ""} /><i /></div>
            {createStep === "photo" ? <>
              <label className={`memory-photo-drop ${photoPreview ? "has-photo" : ""}`}>
                {photoPreview ? <img src={photoPreview} alt="선택한 장면" /> : <div><b>사진을 선택하세요</b><span>촬영 날짜와 위치를 자동으로 정리해드려요</span><small>JPG · PNG · WEBP · HEIC, 최대 20MB</small></div>}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" onChange={event => void inspectPhoto(event.target.files?.[0])} />
              </label>
              {photoPreview && <div className="photo-analysis-result"><div><span className={metadataPending ? "is-reading" : ""}>{metadataPending ? "분석 중" : "분석 완료"}</span><b>{fileName}</b></div><ul><li><span>촬영일</span><b>{photoMetadata?.capturedAt ? new Date(photoMetadata.capturedAt).toLocaleString("ko-KR") : "정보 없음 · 다음 단계에서 입력"}</b></li><li><span>위치</span><b>{photoMetadata?.locationSource === "exif" ? `${latitude}, ${longitude}` : "GPS 없음 · 다음 단계에서 연결"}</b></li><li><span>카메라</span><b>{[photoMetadata?.cameraMake, photoMetadata?.cameraModel].filter(Boolean).join(" ") || "정보 없음"}</b></li></ul></div>}
              <p className="memory-privacy-note">원본 사진은 둘만 접근할 수 있는 비공개 보관함에 저장됩니다.</p>
              <div className="dialog-actions"><button className="outline-button" type="button" onClick={() => setOpen(false)}>취소</button><button className="text-button" type="button" onClick={continueToStory}>사진 없이 기록</button><button className="primary-button" type="button" onClick={continueToStory} disabled={metadataPending}>{photoPreview ? "이 장면으로 계속" : "다음"}</button></div>
            </> : <>
              <div className="memory-story-preview">{photoPreview ? <img src={photoPreview} alt="기억 대표 사진" /> : <div>NO PHOTO</div>}<button type="button" onClick={() => setCreateStep("photo")}>사진 변경</button></div>
              <label className="field memory-title-field"><span>이 기억의 제목</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="계획 없이 걷던 토요일" required autoFocus /></label>
              <label className="field"><span>한 줄 기록 <small>선택</small></span><textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="그날 가장 오래 기억하고 싶은 순간은?" rows={3} /></label>
              <div className="memory-fact-grid"><label className="field"><span>날짜</span><input type="date" value={happenedOn} onChange={event => setHappenedOn(event.target.value)} required /></label><label className="field"><span>기억 종류</span><select value={memoryType} onChange={event => setMemoryType(event.target.value as MemoryType)}><option value="free">우리의 일상</option><option value="trip">여행</option><option value="date">데이트</option></select></label></div>
              <label className="field"><span>연결된 장소 <small>선택</small></span><select value={placeId} onChange={event => setPlaceId(event.target.value)}><option value="">직접 적기</option>{sortedPlaces.map(place => <option key={place.id} value={place.id}>{place.name} · {place.district}</option>)}</select></label>
              <label className="field"><span>장소 이름</span><input value={locationLabel} onChange={event => setLocationLabel(event.target.value)} placeholder="성수 · 카페 골목" /></label>
              <details className="memory-location-details"><summary>지도 위치 세밀하게 조정</summary><div className="coordinate-fields"><label className="field"><span>위도</span><input inputMode="decimal" value={latitude} onChange={event => { setLatitude(event.target.value); setPhotoMetadata(current => current ? { ...current, locationSource: "manual" } : current); }} /></label><label className="field"><span>경도</span><input inputMode="decimal" value={longitude} onChange={event => { setLongitude(event.target.value); setPhotoMetadata(current => current ? { ...current, locationSource: "manual" } : current); }} /></label></div></details>
              {!selectedFile && <label className="field"><span>사진 URL <small>선택</small></span><input value={coverUrl} onChange={event => setCoverUrl(event.target.value)} placeholder="https://..." /></label>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="dialog-actions"><button className="outline-button" type="button" onClick={() => setCreateStep("photo")} disabled={pending}>이전</button><button className="primary-button" type="submit" disabled={pending}>{pending ? "둘의 보관함에 저장 중..." : "기억으로 남기기"}</button></div>
            </>}
          </form>
        </div>
      )}
      {viewer && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setViewer(null)}>
          <article className="memory-viewer" onClick={event => event.stopPropagation()}>
            {viewer.coverUrl ? <img src={viewer.coverUrl} alt={viewer.title} /> : <div className="abstract-photo large">{viewer.locationLabel || viewer.title}</div>}
            {!editing ? <div>
              <span>{formatKoDate(viewer.happenedOn)}{viewer.locationLabel ? ` · ${viewer.locationLabel}` : ""}</span>
              <h2>{viewer.title}</h2>
              <p>{viewer.description || "둘만 아는 그날의 장면."}</p>
              {viewer.photos[0] && <div className="memory-photo-facts"><span>{viewer.photos[0].capturedAt ? `촬영 ${new Date(viewer.photos[0].capturedAt).toLocaleString("ko-KR")}` : "촬영일 정보 없음"}</span><span>{[viewer.photos[0].cameraMake, viewer.photos[0].cameraModel].filter(Boolean).join(" ") || "카메라 정보 없음"}</span>{viewer.coordinates && <Link href="/our-map">지도에서 보기 →</Link>}</div>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="dialog-actions memory-viewer-actions"><button className="danger-button" type="button" disabled={pending} onClick={() => void removeCurrentMemory()}>삭제</button><button className="outline-button" type="button" onClick={() => beginEdit(viewer)}>수정</button><button className="primary-button" type="button" onClick={() => setViewer(null)}>닫기</button></div>
            </div> : <form className="memory-edit-form" onSubmit={event => void saveEdit(event)}>
              <label className="field"><span>제목</span><input value={editTitle} onChange={event => setEditTitle(event.target.value)} required /></label>
              <div className="coordinate-fields"><label className="field"><span>날짜</span><input type="date" value={editDate} onChange={event => setEditDate(event.target.value)} required /></label><label className="field"><span>종류</span><select value={editType} onChange={event => setEditType(event.target.value as MemoryType)}><option value="free">그냥 그날</option><option value="trip">여행</option><option value="date">데이트</option></select></label></div>
              <label className="field"><span>장소 이름</span><input value={editLocation} onChange={event => setEditLocation(event.target.value)} /></label>
              <label className="field"><span>기록</span><textarea rows={3} value={editDescription} onChange={event => setEditDescription(event.target.value)} /></label>
              <div className="coordinate-fields"><label className="field"><span>위도</span><input inputMode="decimal" value={editLatitude} onChange={event => setEditLatitude(event.target.value)} /></label><label className="field"><span>경도</span><input inputMode="decimal" value={editLongitude} onChange={event => setEditLongitude(event.target.value)} /></label></div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="dialog-actions"><button className="outline-button" type="button" onClick={() => setEditing(false)} disabled={pending}>취소</button><button className="primary-button" type="submit" disabled={pending}>{pending ? "저장 중..." : "변경 저장"}</button></div>
            </form>}
          </article>
        </div>
      )}
    </>
  );
}
