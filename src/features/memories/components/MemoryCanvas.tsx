"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  clamp,
  contentRect,
  fitRect,
  gridFill,
  MAX_ZOOM,
  MIN_ZOOM,
  panCamera,
  screenToWorld,
  viewportPoint,
  WORLD_H,
  WORLD_W,
  zoomAt,
  type Camera,
} from "../canvasCamera";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createRefreshQueue } from "@/features/collaboration/refreshQueue";
import {
  emptyBoardState,
  readBoardState,
  writeBoardState,
  writeBoardSyncedAt,
  type CorkBoardState,
  type CorkPose,
} from "../corkLayout";
import { saveMemoryWallBoard, loadMemoryWallBoard } from "../wallBoardActions";
import { mergeBoardEdits } from "../mergeBoardEdits";
import { subscribeMemoryWallBoard } from "../wallBoardLive";
import { isNewerBoardVersion } from "../wallBoardVersion";
import { clearWallDraft, readWallDraft, writeWallDraft } from "../wallDraftCache";
import { restoreWallEdit, wallContentEqual, type WallEdit } from "../wallHistory";
import { validWallBoard } from "../boardValidation";
import styles from "./MemoryCanvas.module.css";
import {
  createWallText,
  WALL_TEXT_SIZES,
  type WallText,
  type WallTextFont,
  type WallTextWeight,
} from "../wallText";
import {
  createInkStroke,
  eraseStrokes,
  INK_COLORS,
  MARKER_SIZES,
  PEN_SIZES,
  strokePath,
  type InkPoint,
  type InkStroke,
  type InkTool,
} from "../inkStrokes";

export type CanvasTool = "select" | "pan" | "pen" | "marker" | "eraser" | "text";

type CanvasContextValue = {
  zoom: number;
  interactive: boolean;
  beginPieceEdit?: (cancel?: () => void) => void;
  endPieceEdit?: (poses: Record<string, CorkPose>) => void;
  nextLayerZ?: () => number;
};

export const MemoryCanvasContext = createContext<CanvasContextValue>({ zoom: 1, interactive: true });

const TOOLS: ReadonlyArray<{ id: CanvasTool; label: string }> = [
  { id: "select", label: "선택" },
  { id: "pan", label: "이동" },
  { id: "pen", label: "펜" },
  { id: "marker", label: "형광" },
  { id: "text", label: "텍스트" },
  { id: "eraser", label: "지우개" },
];

const SIZE_LABEL: Record<number, string> = {
  7: "가늘게",
  14: "보통",
  18: "가늘게",
  22: "굵게",
  28: "보통",
  40: "굵게",
};

function StudioIcon({ name }: { name: CanvasTool }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {name === "select" && <path d="M5 3.8 19 12.2l-6.4 1.3L10.2 21 5 3.8Z" />}
      {name === "pan" && (
        <>
          <path d="M8 11.2V8.4a1.6 1.6 0 0 1 3.2 0V11" />
          <path d="M11.2 10.4V7.6a1.6 1.6 0 1 1 3.2 0V11" />
          <path d="M14.4 10.8V8.8a1.6 1.6 0 1 1 3.2 0v5.4c0 2.6-1.8 5.2-5.4 5.2H12c-3.2 0-5.2-1.8-5.2-4.6V11" />
        </>
      )}
      {name === "pen" && (
        <>
          <path d="M14.2 5.2 18.8 9.8" />
          <path d="M4 20 5.6 14.6 16.2 4a1.8 1.8 0 0 1 2.6 0l1.2 1.2a1.8 1.8 0 0 1 0 2.6L9.4 18.4 4 20Z" />
        </>
      )}
      {name === "marker" && (
        <>
          <path d="M7.2 14.8 16.8 5.2 19 7.4 9.4 17H7.2v-2.2Z" />
          <path d="M5 19.2h14" />
        </>
      )}
      {name === "eraser" && (
        <>
          <path d="M5 14.6 12.2 7.4l4.8 4.8-7.2 7.2H5v-5.8Z" />
          <path d="M9.2 20h10.4" />
        </>
      )}
      {name === "text" && (
        <>
          <path d="M6 5.5h12" />
          <path d="M12 5.5V19" />
          <path d="M8.5 19h7" />
        </>
      )}
    </svg>
  );
}

function nextTextLayerZ(poses: Record<string, CorkPose>, texts: WallText[]) {
  const poseZ = Object.values(poses).map(item => item.z);
  const textZ = texts.map(item => item.z);
  return Math.max(40, ...poseZ, ...textZ) + 1;
}

export function MemoryCanvas({
  coupleId,
  poses,
  setPoses,
  onScatter,
  onReset,
  toolbarHost,
  children,
}: {
  coupleId: string;
  poses: Record<string, CorkPose>;
  setPoses: Dispatch<SetStateAction<Record<string, CorkPose>>>;
  onScatter: () => void;
  onReset: () => void;
  toolbarHost?: HTMLElement | null;
  children: ReactNode;
}) {
  const session = useAppSession();
  const userId = session.mode === "authenticated" ? session.userId : null;
  const scopeRef = useRef({ coupleId, userId });
  scopeRef.current = { coupleId, userId };
  const activeRef = useRef(true);
  const viewRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 0.42 });
  const posesRef = useRef(poses);
  const strokesRef = useRef<InkStroke[]>([]);
  const textsRef = useRef<WallText[]>([]);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const panRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const pinchRef = useRef<{ camera: Camera; dist: number; world: { x: number; y: number } } | null>(null);
  const drawRef = useRef<{ pointerId: number; tool: InkTool | "eraser"; points: InkPoint[]; simulatePressure: boolean } | null>(null);
  const textDragRef = useRef<{ pointerId: number; id: string; startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const historyRef = useRef<WallEdit[]>([]);
  const futureRef = useRef<WallEdit[]>([]);
  const gestureBeforeRef = useRef<CorkBoardState | null>(null);
  const pieceDraggingRef = useRef(false);
  const cancelPieceRef = useRef<(() => void) | null>(null);
  const layoutBeforeRef = useRef<CorkBoardState | null>(null);
  const remotePromiseRef = useRef<Promise<void> | null>(null);
  const detachedRef = useRef(false);
  const [, setHistoryVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const remoteSaveTimer = useRef<number | null>(null);
  const draftSaveTimer = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const loadedRef = useRef(false);
  const [camera, setCameraState] = useState<Camera>(cameraRef.current);
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const editingTextRef = useRef<string | null>(null);
  const textEditingBeforeRef = useRef<CorkBoardState | null>(null);
  const [texts, setTexts] = useState<WallText[]>([]);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [color, setColor] = useState(INK_COLORS[0].color as string);
  const [textColor, setTextColor] = useState(INK_COLORS[0].color as string);
  const [textFont, setTextFont] = useState<WallTextFont>("hand");
  const [textWeight, setTextWeight] = useState<WallTextWeight>("normal");
  const [textSize, setTextSize] = useState<number>(WALL_TEXT_SIZES[1]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [penSize, setPenSize] = useState<number>(PEN_SIZES[1]);
  const [markerSize, setMarkerSize] = useState<number>(MARKER_SIZES[1]);
  const [livePath, setLivePath] = useState("");
  const [spacePan, setSpacePan] = useState(false);
  posesRef.current = poses;
  strokesRef.current = strokes;
  textsRef.current = texts;
  editingTextRef.current = editingTextId;
  cameraRef.current = camera;

  const boardSnapshot = useCallback((): CorkBoardState => ({
    v: 4,
    camera: cameraRef.current,
    poses: posesRef.current,
    strokes: strokesRef.current,
    texts: textsRef.current,
  }), []);

  const baseRef = useRef<CorkBoardState>(emptyBoardState());
  const remoteVersionRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingRemoteRef = useRef<{ state: CorkBoardState; updatedAt: string } | null>(null);
  const drainRemoteRef = useRef(() => {});
  const retryRemoteRef = useRef(() => {});
  useEffect(() => {
    activeRef.current = true;
    detachedRef.current = false;
    savingRef.current = false;
    return () => { activeRef.current = false; };
  }, [coupleId, userId]);
  const [syncError, setSyncError] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "pending" | "saving" | "saved">("idle");
  const flushRemoteSave = useCallback((_state?: CorkBoardState) => {
    if (remoteSaveTimer.current) window.clearTimeout(remoteSaveTimer.current);
    remoteSaveTimer.current = window.setTimeout(() => {
      const expectedScope = { coupleId, userId };
      const isCurrentScope = () => activeRef.current && scopeRef.current.coupleId === coupleId && scopeRef.current.userId === userId;
      if (!isCurrentScope() || !dirtyRef.current) return;
      if (!loadedRef.current || savingRef.current || drawRef.current || textDragRef.current || pieceDraggingRef.current || editingTextRef.current) {
        flushRemoteSave();
        return;
      }
      savingRef.current = true;
      setSyncStatus("saving");
      const sent = boardSnapshot();
      const base = baseRef.current;
      const pending = (async () => {
        try {
          const result = await saveMemoryWallBoard(sent, base, expectedScope);
          if ("error" in result) {
            if (isCurrentScope()) { setSyncError(result.error); setSyncStatus("pending"); }
            return;
          }
          const latest = boardSnapshot();
          const next = { ...mergeBoardEdits(sent, latest, result.state), camera: latest.camera };
          const storedDraft = readWallDraft(coupleId, userId);
          if (!isCurrentScope() && storedDraft && !wallContentEqual(storedDraft.state, latest)) { dirtyRef.current = false; return; }
          baseRef.current = result.state;
          remoteVersionRef.current = result.updatedAt;
          dirtyRef.current = !wallContentEqual(next, result.state);
          writeBoardState(coupleId, next);
          writeBoardSyncedAt(coupleId, result.updatedAt);
          if (dirtyRef.current) writeWallDraft(coupleId, userId, result.state, next);
          else clearWallDraft(coupleId, userId);
          posesRef.current = next.poses; strokesRef.current = next.strokes; textsRef.current = next.texts;
          if (!isCurrentScope()) return;
          setPoses(next.poses); setStrokes(next.strokes); setTexts(next.texts);
          setSyncError("");
          setSyncStatus(dirtyRef.current ? "pending" : "saved");
          if (dirtyRef.current) flushRemoteSave();
        } catch {
          if (isCurrentScope()) { setSyncError("아직 저장되지 않았어요. 연결을 확인한 뒤 다시 저장해 주세요."); setSyncStatus("pending"); }
        } finally {
          savingRef.current = false;
          if (isCurrentScope()) drainRemoteRef.current();
        }
      })();
      remotePromiseRef.current = pending;
    }, 420);
  }, [boardSnapshot, coupleId, setPoses, userId]);

  const persist = useCallback((next?: { poses?: Record<string, CorkPose>; strokes?: InkStroke[]; texts?: WallText[]; camera?: Camera | null }) => {
    dirtyRef.current = true;
    setSyncStatus("pending");
    if (next?.poses) posesRef.current = next.poses;
    if (next?.strokes) strokesRef.current = next.strokes;
    if (next?.texts) textsRef.current = next.texts;
    if (next?.camera) cameraRef.current = next.camera;
    if (draftSaveTimer.current) window.clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = window.setTimeout(() => {
      const state = boardSnapshot();
      writeBoardState(coupleId, state);
      writeWallDraft(coupleId, userId, baseRef.current, state);
    }, 80);
    flushRemoteSave();
  }, [boardSnapshot, coupleId, flushRemoteSave, userId]);

  const recordEdit = useCallback((before: CorkBoardState, after: CorkBoardState) => {
    if (wallContentEqual(before, after)) return;
    historyRef.current = [...historyRef.current.slice(-39), { before, after }];
    futureRef.current = [];
    setHistoryVersion(version => version + 1);
  }, []);

  const applyBoard = useCallback((board: CorkBoardState) => {
    posesRef.current = board.poses;
    strokesRef.current = board.strokes;
    textsRef.current = board.texts;
    setPoses(board.poses);
    setStrokes(board.strokes);
    setTexts(board.texts);
    if (board.camera) {
      cameraRef.current = board.camera;
      setCameraState(board.camera);
    }
  }, [setPoses]);

  const patchText = useCallback((id: string, patch: Partial<WallText>, historic = true) => {
    const before = boardSnapshot();
    const next = textsRef.current.map(item => (item.id === id ? { ...item, ...patch } : item));
    if (JSON.stringify(next) === JSON.stringify(textsRef.current)) return;
    setTexts(next);
    persist({ texts: next });
    if (historic) recordEdit(before, boardSnapshot());
  }, [boardSnapshot, persist, recordEdit]);

  const removeText = useCallback((id: string) => {
    const before = boardSnapshot();
    const next = textsRef.current.filter(item => item.id !== id);
    setTexts(next);
    setSelectedTextId(current => (current === id ? null : current));
    setEditingTextId(current => (current === id ? null : current));
    persist({ texts: next });
    recordEdit(before, boardSnapshot());
  }, [boardSnapshot, persist, recordEdit]);

  const restoreHistory = useCallback((redo = false) => {
    if (drawRef.current || pieceDraggingRef.current || textDragRef.current || editingTextRef.current) return;
    const source = redo ? futureRef.current : historyRef.current;
    const edit = source.pop();
    if (!edit) return;
    const current = boardSnapshot();
    const next = restoreWallEdit(current, redo ? edit.before : edit.after, redo ? edit.after : edit.before);
    if (!validWallBoard(next)) {
      source.push(edit);
      setSyncError("현재 벽면에 되돌릴 공간이 부족해요. 필기를 정리한 뒤 다시 시도해 주세요.");
      return;
    }
    applyBoard(next);
    persist(next);
    // Redo contains only what this undo actually changed, excluding partner edits.
    const inverse = redo ? { before: current, after: next } : { before: next, after: current };
    (redo ? historyRef.current : futureRef.current).push(inverse);
    setHistoryVersion(version => version + 1);
  }, [applyBoard, boardSnapshot, persist]);

  const setCamera = useCallback((update: Camera | ((current: Camera) => Camera)) => {
    const next = typeof update === "function" ? update(cameraRef.current) : update;
    cameraRef.current = next;
    setCameraState(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      writeBoardState(coupleId, boardSnapshot());
    }, 160);
  }, [boardSnapshot, coupleId]);

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    dirtyRef.current = false;
    pendingRemoteRef.current = null;
    remoteVersionRef.current = null;
    baseRef.current = emptyBoardState();
    const local = readBoardState(coupleId);
    const pendingDraft = readWallDraft(coupleId, userId);
    const cached = pendingDraft?.state ?? local;
    const loadBase = pendingDraft?.base ?? cached;
    baseRef.current = loadBase;
    applyBoard(cached);
    if (pendingDraft) dirtyRef.current = true;
    setReady(false);
    setSyncStatus(pendingDraft ? "pending" : "idle");

    const finishCamera = (board: CorkBoardState) => {
      const applyCamera = () => {
        const view = viewRef.current?.getBoundingClientRect();
        const framed = view ? fitRect(view, contentRect(Object.values(board.poses))) : { x: 0, y: 0, zoom: 0.8 };
        const next = board.camera ?? framed;
        cameraRef.current = next;
        setCameraState(next);
      };
      applyCamera();
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        if (board.camera) applyCamera(); else fitView();
        loadedRef.current = true;
        setReady(true);
        if (dirtyRef.current) flushRemoteSave();
      });
    };

    void loadMemoryWallBoard().then(({ state: remote, updatedAt }) => {
      if (cancelled) return;
      // A newer socket/save response can arrive before this initial read.
      if (remoteVersionRef.current && (!updatedAt || !isNewerBoardVersion(updatedAt, remoteVersionRef.current))) {
        finishCamera(boardSnapshot());
        return;
      }
      baseRef.current = remote ?? emptyBoardState();
      remoteVersionRef.current = updatedAt;
      const merged = dirtyRef.current
        ? { ...mergeBoardEdits(loadBase, boardSnapshot(), remote ?? emptyBoardState()), camera: cached.camera }
        : remote ? { ...remote, camera: local.camera } : local;
      dirtyRef.current = !wallContentEqual(merged, baseRef.current);
      if (dirtyRef.current) writeWallDraft(coupleId, userId, baseRef.current, merged);
      applyBoard(merged);
      writeBoardState(coupleId, merged);
      if (updatedAt) writeBoardSyncedAt(coupleId, updatedAt);
      finishCamera(merged);
    }).catch(() => {
      if (cancelled) return;
      if (remoteVersionRef.current) { finishCamera(boardSnapshot()); return; }
      const next = dirtyRef.current ? { ...boardSnapshot(), camera: cached.camera } : cached;
      // Retrying applies only edits since the cached board; cached data alone
      // must not overwrite a partner's newer server board after an outage.
      baseRef.current = loadBase;
      applyBoard(next);
      finishCamera(next);
      setSyncError("벽면을 불러오지 못했어요. 현재 꾸민 내용은 보관되어 있어요. 연결을 확인한 뒤 다시 저장해 주세요.");
    });

    const receive = (remote: CorkBoardState, updatedAt: string) => {
      if (cancelled || !isNewerBoardVersion(updatedAt, remoteVersionRef.current)) return;
      if (savingRef.current || drawRef.current || textDragRef.current || pieceDraggingRef.current || editingTextRef.current) {
        if (!pendingRemoteRef.current || isNewerBoardVersion(updatedAt, pendingRemoteRef.current.updatedAt)) pendingRemoteRef.current = { state: remote, updatedAt };
        return;
      }
      remoteVersionRef.current = updatedAt;
      const next = { ...(dirtyRef.current ? mergeBoardEdits(baseRef.current, boardSnapshot(), remote) : remote), camera: cameraRef.current };
      baseRef.current = remote;
      applyBoard(next);
      writeBoardState(coupleId, next);
      writeBoardSyncedAt(coupleId, updatedAt);
      dirtyRef.current = !wallContentEqual(next, remote);
      if (dirtyRef.current) { writeWallDraft(coupleId, userId, remote, next); flushRemoteSave(); }
      else { clearWallDraft(coupleId, userId); setSyncStatus("saved"); }
      if (!loadedRef.current) finishCamera(next);
    };
    const drainRemote = () => {
      if (!pendingRemoteRef.current || savingRef.current || drawRef.current || textDragRef.current || pieceDraggingRef.current || editingTextRef.current) return;
      const pending = pendingRemoteRef.current;
      pendingRemoteRef.current = null;
      receive(pending.state, pending.updatedAt);
    };
    drainRemoteRef.current = drainRemote;
    const queue = createRefreshQueue(async () => {
      try {
        const { state, updatedAt } = await loadMemoryWallBoard();
        if (cancelled) return;
        if (state && updatedAt) receive(state, updatedAt);
        setSyncError("");
      } catch { if (!cancelled) setSyncError("벽면의 최신 변경을 불러오지 못했어요. 현재 내용은 보관되어 있어요."); }
    }, { canRun: () => !cancelled && document.visibilityState === "visible" });
    const live = subscribeMemoryWallBoard(coupleId, receive, queue.schedule, userId ?? undefined);
    retryRemoteRef.current = queue.schedule;

    return () => {
      cancelled = true;
      if (drainRemoteRef.current === drainRemote) drainRemoteRef.current = () => {};
      retryRemoteRef.current = () => {};
      pendingRemoteRef.current = null;
      queue.stop();
      live.unsubscribe();
    };
  }, [applyBoard, boardSnapshot, coupleId, flushRemoteSave, userId]);

  useEffect(() => { if (!editingTextId) drainRemoteRef.current(); }, [editingTextId]);

  useEffect(() => {
    if (!loadedRef.current || JSON.stringify(poses) === JSON.stringify(baseRef.current.poses)) return;
    persist({ poses });
    if (layoutBeforeRef.current) { recordEdit(layoutBeforeRef.current, boardSnapshot()); layoutBeforeRef.current = null; }
  }, [boardSnapshot, persist, poses, recordEdit]);

  useEffect(() => {
    const persistOnLeave = () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (draftSaveTimer.current) window.clearTimeout(draftSaveTimer.current);
      const state = boardSnapshot();
      writeBoardState(coupleId, state);
      if (dirtyRef.current) writeWallDraft(coupleId, userId, baseRef.current, state);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") persistOnLeave(); };
    window.addEventListener("pagehide", persistOnLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", persistOnLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      if (remoteSaveTimer.current) window.clearTimeout(remoteSaveTimer.current);
      persistOnLeave();
      // Strict Mode immediately reactivates this instance; a real unmount does not.
      detachedRef.current = true;
      void Promise.resolve(remotePromiseRef.current).then(async () => {
        if (!detachedRef.current || !dirtyRef.current) return;
        const state = boardSnapshot();
        const cached = readWallDraft(coupleId, userId);
        if (cached && !wallContentEqual(cached.state, state)) return;
        const result = await saveMemoryWallBoard(state, baseRef.current, { coupleId, userId });
        if ("error" in result) return;
        // A newly mounted wall may already have saved a newer pending edit.
        const pending = readWallDraft(coupleId, userId);
        if (pending && !wallContentEqual(pending.state, state)) return;
        writeBoardSyncedAt(coupleId, result.updatedAt);
        writeBoardState(coupleId, { ...result.state, camera: state.camera });
        clearWallDraft(coupleId, userId);
      }).catch(() => {});
    };
  }, [boardSnapshot, coupleId, userId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!ready || event.isComposing || !(event.target instanceof HTMLElement)) return;
      if (event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (!viewRef.current?.contains(event.target)) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedTextId && event.target === viewRef.current) {
        event.preventDefault();
        removeText(selectedTextId);
        return;
      }
      if (event.code === "Space" && !event.repeat && !event.target.closest("button, a, .memory-cork-piece, .memory-wall-text")) {
        setSpacePan(true);
        event.preventDefault();
      }
      if (event.key === "Escape") {
        setSelectedTextId(null);
        setTool("select");
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
        event.preventDefault();
        restoreHistory(event.shiftKey || event.key.toLowerCase() === "y");
      }
    }
    function endSpacePan() {
      setSpacePan(false);
    }
    function onKeyUp(event: KeyboardEvent) { if (event.code === "Space") endSpacePan(); }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", endSpacePan);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", endSpacePan);
    };
  }, [ready, removeText, restoreHistory, selectedTextId]);

  useEffect(() => {
    const node = viewRef.current;
    if (!node) return;
    function onWheel(event: WheelEvent) {
      if (!ready) return;
      event.preventDefault();
      const view = viewRef.current;
      if (!view) return;
      const point = viewportPoint(view.getBoundingClientRect(), event.clientX, event.clientY);
      if (event.ctrlKey || event.metaKey) {
        setCamera(current => zoomAt(current, point, event.deltaY < 0 ? 1.08 : 0.92));
        return;
      }
      setCamera(current => panCamera(current, -event.deltaX, -event.deltaY));
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [ready, setCamera]);

  const drawing = tool === "pen" || tool === "marker" || tool === "eraser";
  const panning = tool === "pan" || spacePan;
  const interactive = ready && tool === "select" && !spacePan;

  useEffect(() => {
    if (!editingTextId) return;
    const text = [...(viewRef.current?.querySelectorAll<HTMLElement>("[data-text-id]") ?? [])].find(node => node.dataset.textId === editingTextId);
    const node = text?.querySelector<HTMLElement>("[contenteditable]");
    if (!node) return;
    node.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [editingTextId]);

  function applyInk(next: InkStroke[], historic: boolean) {
    if (next === strokesRef.current) return;
    if (next.length > strokesRef.current.length && !validWallBoard({ ...boardSnapshot(), strokes: next })) {
      setSyncError("필기가 많아 저장 공간이 가득 찼어요. 일부 필기를 정리한 뒤 이어서 그려 주세요.");
      return;
    }
    const before = boardSnapshot();
    setStrokes(next);
    persist({ strokes: next });
    if (historic) recordEdit(before, boardSnapshot());
  }

  function commitStrokes(next: InkStroke[]) {
    applyInk(next, true);
  }

  function viewPoint(event: { clientX: number; clientY: number }) {
    const view = viewRef.current;
    if (!view) return { x: 0, y: 0 };
    return viewportPoint(view.getBoundingClientRect(), event.clientX, event.clientY);
  }

  function inkPoint(event: ReactPointerEvent, cameraNow: Camera): InkPoint {
    const world = screenToWorld(cameraNow, viewPoint(event));
    const pressure = event.pressure > 0 ? clamp(event.pressure, 0, 1) : 0.5;
    return [clamp(world.x, 0, WORLD_W), clamp(world.y, 0, WORLD_H), pressure];
  }

  function pointerDistance() {
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function pointerMid() {
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return { x: 0, y: 0 };
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  }

  function beginPinch(cameraNow: Camera) {
    cancelPieceRef.current?.();
    if (gestureBeforeRef.current && (drawRef.current || textDragRef.current)) {
      const next = restoreWallEdit(boardSnapshot(), boardSnapshot(), gestureBeforeRef.current);
      applyBoard(next);
      persist(next);
    }
    gestureBeforeRef.current = null;
    drawRef.current = null;
    textDragRef.current = null;
    panRef.current = null;
    setLivePath("");
    const mid = pointerMid();
    pinchRef.current = {
      camera: cameraNow,
      dist: Math.max(1, pointerDistance()),
      world: screenToWorld(cameraNow, mid),
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!ready || event.button === 2) return;
    if ((event.target as HTMLElement).closest("[contenteditable], textarea, input")) return;
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
    }
    const view = viewRef.current;
    if (!view) return;
    view.focus({ preventScroll: true });
    const point = viewPoint(event);
    pointersRef.current.set(event.pointerId, point);
    const textHit = (event.target as HTMLElement).closest(".memory-wall-text") as HTMLElement | null;
    const textId = textHit?.dataset.textId;
    const capture = textHit && textId && !panning && (tool === "select" || tool === "text") && pointersRef.current.size === 1 ? textHit : view;
    try {
      capture.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (pointersRef.current.size === 2) {
      beginPinch(cameraRef.current);
      return;
    }
    if (textId && !panning && (tool === "select" || tool === "text") && event.button === 0) {
      textHit?.focus({ preventScroll: true });
      selectText(textId);
      if (tool === "text") editText(textId);
      if (tool === "select") {
        gestureBeforeRef.current = boardSnapshot();
        textDragRef.current = { pointerId: event.pointerId, id: textId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
      }
      return;
    }
    setSelectedTextId(null);
    if (tool === "text" && event.button === 0) {
      textEditingBeforeRef.current = boardSnapshot();
      const world = screenToWorld(cameraRef.current, viewPoint(event));
      const created = createWallText({
        authorId: userId ?? undefined,
        x: clamp(world.x, 0, WORLD_W - 180),
        y: clamp(world.y, 0, WORLD_H - 80),
        z: nextTextLayerZ(posesRef.current, textsRef.current),
        color: textColor,
        fontFamily: textFont,
        fontWeight: textWeight,
        fontSize: textSize,
      });
      const next = [...textsRef.current, created];
      if (!validWallBoard({ ...boardSnapshot(), texts: next })) {
        setSyncError("벽면이 가득 찼어요. 일부 글이나 필기를 정리한 뒤 글을 남겨 주세요.");
        textEditingBeforeRef.current = null;
        return;
      }
      setTexts(next);
      persist({ texts: next });
      setSelectedTextId(created.id);
      setEditingTextId(created.id);
      return;
    }
    const wantsPan = event.button === 1 || panning || (tool === "select" && event.currentTarget === view && !(event.target as HTMLElement).closest(".memory-cork-piece"));
    if (wantsPan && event.button !== 2) {
      panRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      return;
    }
    if (!drawing || event.button !== 0) return;
    const size = tool === "marker" ? markerSize : tool === "eraser" ? 28 : penSize;
    const point3 = inkPoint(event, cameraRef.current);
    gestureBeforeRef.current = boardSnapshot();
    drawRef.current = {
      pointerId: event.pointerId,
      tool: tool === "eraser" ? "eraser" : tool,
      points: [point3],
      simulatePressure: event.pointerType !== "pen",
    };
    if (tool === "eraser") {
      applyInk(eraseStrokes(strokesRef.current, point3[0], point3[1], size), false);
      return;
    }
    setLivePath(strokePath([point3], size, drawRef.current.simulatePressure));
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, viewPoint(event));
    }
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pinch = pinchRef.current;
      const dist = Math.max(1, pointerDistance());
      const mid = pointerMid();
      const zoom = clamp(pinch.camera.zoom * (dist / pinch.dist), MIN_ZOOM, MAX_ZOOM);
      setCamera({
        zoom,
        x: mid.x - pinch.world.x * zoom,
        y: mid.y - pinch.world.y * zoom,
      });
      return;
    }
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      setCamera(current => panCamera(current, event.clientX - pan.lastX, event.clientY - pan.lastY));
      pan.lastX = event.clientX;
      pan.lastY = event.clientY;
      return;
    }
    const textDrag = textDragRef.current;
    if (textDrag && textDrag.pointerId === event.pointerId) {
      if (!textDrag.moved && Math.hypot(event.clientX - textDrag.startX, event.clientY - textDrag.startY) < 5) return;
      textDrag.moved = true;
      const scale = cameraRef.current.zoom || 1;
      const dx = (event.clientX - textDrag.lastX) / scale;
      const dy = (event.clientY - textDrag.lastY) / scale;
      textDrag.lastX = event.clientX;
      textDrag.lastY = event.clientY;
      const origin = textsRef.current.find(item => item.id === textDrag.id);
      if (!origin) return;
      patchText(textDrag.id, { x: clamp(origin.x + dx, 0, WORLD_W - 180), y: clamp(origin.y + dy, 0, WORLD_H - 80) }, false);
      return;
    }
    const draw = drawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) return;
    const point = inkPoint(event, cameraRef.current);
    if (draw.points.length >= 4000) {
      draw.points = draw.points.filter((_, index) => index % 2 === 0 || index === draw.points.length - 1);
    }
    draw.points.push(point);
    const size = draw.tool === "marker" ? markerSize : draw.tool === "eraser" ? 28 : penSize;
    if (draw.tool === "eraser") {
      applyInk(eraseStrokes(strokesRef.current, point[0], point[1], size), false);
      return;
    }
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const live = drawRef.current;
      if (!live || live.tool === "eraser") return;
      const liveSize = live.tool === "marker" ? markerSize : penSize;
      setLivePath(strokePath(live.points, liveSize, live.simulatePressure));
    });
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
    const textDrag = textDragRef.current;
    if (textDrag?.pointerId === event.pointerId) textDragRef.current = null;
    const view = viewRef.current;
    if (view?.hasPointerCapture(event.pointerId)) view.releasePointerCapture(event.pointerId);
    const target = event.target;
    if (target instanceof Element && target !== view && target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    const draw = drawRef.current;
    if (draw?.pointerId === event.pointerId) {
      drawRef.current = null;
      setLivePath("");
      if (!cancelled && draw.tool !== "eraser" && draw.points.length) {
        applyInk([...strokesRef.current, createInkStroke({
          tool: draw.tool, color,
          size: draw.tool === "marker" ? markerSize : penSize,
          points: draw.points, simulatePressure: draw.simulatePressure,
        })], false);
      }
    }
    if ((draw?.pointerId === event.pointerId || textDrag?.pointerId === event.pointerId) && gestureBeforeRef.current) {
      if (cancelled) {
        const next = restoreWallEdit(boardSnapshot(), boardSnapshot(), gestureBeforeRef.current);
        applyBoard(next);
        persist(next);
      } else recordEdit(gestureBeforeRef.current, boardSnapshot());
      gestureBeforeRef.current = null;
    }
    drainRemoteRef.current();
    if (dirtyRef.current) flushRemoteSave();
    if (pointersRef.current.size === 1) {
      const [pointerId, point] = [...pointersRef.current.entries()][0];
      const bounds = view?.getBoundingClientRect();
      if (bounds) panRef.current = { pointerId, lastX: point.x + bounds.left, lastY: point.y + bounds.top };
    }
  }

  function selectText(id: string) {
    const selected = textsRef.current.find(item => item.id === id);
    if (!selected) return;
    setSelectedTextId(id);
    setTextColor(selected.color);
    setTextFont(selected.fontFamily);
    setTextWeight(selected.fontWeight);
    setTextSize(selected.fontSize);
  }

  function editText(id: string) {
    selectText(id);
    textEditingBeforeRef.current = boardSnapshot();
    setEditingTextId(id);
  }

  function fitView() {
    const view = viewRef.current;
    if (!view) return;
    const bounds = view.getBoundingClientRect();
    const objects = [...view.querySelectorAll<HTMLElement>("[data-cork-id], .memory-wall-text")].map(node => ({
      x: Number.parseFloat(node.style.left) || 0,
      y: Number.parseFloat(node.style.top) || 0,
      width: node.offsetWidth,
      height: node.offsetHeight,
    }));
    for (const stroke of strokesRef.current) {
      if (!stroke.points.length) continue;
      const points = contentRect(stroke.points.map(([x, y]) => ({ x, y })), { width: stroke.size, height: stroke.size });
      objects.push(points);
    }
    if (!objects.length) { setCamera(fitRect(bounds, contentRect([]))); return; }
    const left = Math.min(...objects.map(item => item.x));
    const top = Math.min(...objects.map(item => item.y));
    const right = Math.max(...objects.map(item => item.x + item.width));
    const bottom = Math.max(...objects.map(item => item.y + item.height));
    setCamera(fitRect(bounds, { x: left - 30, y: top - 30, width: right - left + 60, height: bottom - top + 60 }));
  }

  const beginPieceEdit = useCallback((cancel?: () => void) => {
    pieceDraggingRef.current = true;
    cancelPieceRef.current = cancel ?? null;
    gestureBeforeRef.current = boardSnapshot();
  }, [boardSnapshot]);
  const endPieceEdit = useCallback((nextPoses: Record<string, CorkPose>) => {
    posesRef.current = nextPoses;
    pieceDraggingRef.current = false;
    cancelPieceRef.current = null;
    if (gestureBeforeRef.current) recordEdit(gestureBeforeRef.current, boardSnapshot());
    gestureBeforeRef.current = null;
    if (!wallContentEqual(baseRef.current, boardSnapshot())) persist({ poses: nextPoses });
    drainRemoteRef.current();
  }, [boardSnapshot, persist, recordEdit]);
  const nextLayerZ = useCallback(() => nextTextLayerZ(posesRef.current, textsRef.current), []);
  const context = useMemo<CanvasContextValue>(() => ({ zoom: camera.zoom, interactive, beginPieceEdit, endPieceEdit, nextLayerZ }), [camera.zoom, interactive, beginPieceEdit, endPieceEdit, nextLayerZ]);

  const inkSizes = tool === "marker" ? MARKER_SIZES : PEN_SIZES;
  const activeSize = tool === "marker" ? markerSize : penSize;
  const toolbar = (
    <div className={`memory-studio-bar ${styles.toolbar}`} aria-busy={!ready}>
      <div className="memory-studio-main">
        <div className="memory-studio-group" role="toolbar" aria-label="벽면 도구">
          {TOOLS.map(item => (
            <button
              className={`memory-studio-tool ${tool === item.id ? "is-active" : ""}`}
              type="button"
              key={item.id}
              aria-pressed={tool === item.id}
              aria-label={item.label}
              title={`${item.label} 도구`}
              disabled={!ready}
              onClick={() => { setTool(item.id); if (item.id !== "text" && item.id !== "select") setSelectedTextId(null); }}
            >
              <StudioIcon name={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="memory-studio-actions">
          <div className={styles.history} role="group" aria-label="편집 기록">
            <button className="memory-studio-action" type="button" disabled={!ready || !historyRef.current.length} onClick={() => restoreHistory()} title="되돌리기 (Ctrl / ⌘ Z)" aria-label="되돌리기"><span aria-hidden="true">↶</span></button>
            <button className="memory-studio-action" type="button" disabled={!ready || !futureRef.current.length} onClick={() => restoreHistory(true)} title="다시 실행 (Ctrl / ⌘ Shift Z)" aria-label="다시 실행"><span aria-hidden="true">↷</span></button>
          </div>
          <details className={styles.arrange}>
            <summary>배치·정리 <span aria-hidden="true">⌄</span></summary>
            <div className={styles.arrangeMenu} role="group" aria-label="벽면 배치와 정리">
              <button className="memory-studio-action" type="button" disabled={!ready} onClick={fitView}>전체 보기</button>
              <button className="memory-studio-action" type="button" disabled={!ready} onClick={() => { layoutBeforeRef.current = boardSnapshot(); onScatter(); window.requestAnimationFrame(fitView); }}>흩뿌리기</button>
              <button className="memory-studio-action" type="button" disabled={!ready} onClick={() => { layoutBeforeRef.current = boardSnapshot(); onReset(); window.requestAnimationFrame(fitView); }}>가지런히</button>
              <button className={`memory-studio-action ${styles.clearInk}`} type="button" onClick={() => commitStrokes([])} disabled={!ready || !strokes.length}>필기 지우기</button>
            </div>
          </details>
        </div>
      </div>
      <p className={`memory-sync-status is-${syncStatus}`} role="status" aria-live="polite">
        {!ready ? <><i className="button-spinner" aria-hidden="true" /> 벽면을 불러오는 중</> : syncStatus === "saving" ? <><i className="button-spinner" aria-hidden="true" /> 함께 저장하는 중</> : syncStatus === "saved" ? "✓ 함께 저장됨" : syncStatus === "pending" ? "변경 내용을 저장할 준비 중이에요" : "사진과 글을 자유롭게 꾸며 보세요"}
      </p>
      {(tool === "pen" || tool === "marker") && (
        <div className="memory-studio-ink">
          <div className="memory-studio-swatches" aria-label="잉크 색">
            {INK_COLORS.map(item => (
              <button
                className={color === item.color ? "is-active" : ""}
                type="button"
                key={item.id}
                aria-label={item.label}
                aria-pressed={color === item.color}
                title={item.label}
                style={{ background: item.color }}
                onClick={() => setColor(item.color)}
              />
            ))}
          </div>
          <span className="memory-studio-rule" aria-hidden="true" />
          <div className="memory-studio-sizes" aria-label={tool === "marker" ? "형광 굵기" : "펜 굵기"}>
            {inkSizes.map(size => (
              <button
                className={activeSize === size ? "is-active" : ""}
                type="button"
                key={size}
                aria-pressed={activeSize === size}
                aria-label={SIZE_LABEL[size] ?? "굵기"}
                title={SIZE_LABEL[size]}
                onClick={() => (tool === "marker" ? setMarkerSize(size) : setPenSize(size))}
              >
                <i style={{ width: Math.max(6, size * 0.42), height: Math.max(6, size * 0.42) }} />
              </button>
            ))}
          </div>
        </div>
      )}
      {(tool === "text" || selectedTextId) && (
        <div className="memory-studio-ink">
          <div className="memory-studio-fonts" aria-label="글꼴">
            <button
              className={textFont === "hand" ? "is-active" : ""}
              type="button"
              aria-pressed={textFont === "hand"}
              onClick={() => {
                setTextFont("hand");
                if (selectedTextId) patchText(selectedTextId, { fontFamily: "hand" });
              }}
            >
              손글씨
            </button>
            <button
              className={textFont === "sans" ? "is-active" : ""}
              type="button"
              aria-pressed={textFont === "sans"}
              onClick={() => {
                setTextFont("sans");
                if (selectedTextId) patchText(selectedTextId, { fontFamily: "sans" });
              }}
            >
              고딕
            </button>
            <button
              className={textWeight === "bold" ? "is-active" : ""}
              type="button"
              aria-pressed={textWeight === "bold"}
              onClick={() => {
                const next: WallTextWeight = textWeight === "bold" ? "normal" : "bold";
                setTextWeight(next);
                if (selectedTextId) patchText(selectedTextId, { fontWeight: next });
              }}
            >
              굵게
            </button>
          </div>
          <span className="memory-studio-rule" aria-hidden="true" />
          <div className="memory-studio-swatches" aria-label="텍스트 색">
            {INK_COLORS.map(item => (
              <button
                className={textColor === item.color ? "is-active" : ""}
                type="button"
                key={item.id}
                aria-label={item.label}
                aria-pressed={textColor === item.color}
                title={item.label}
                style={{ background: item.color }}
                onClick={() => {
                  setTextColor(item.color);
                  if (selectedTextId) patchText(selectedTextId, { color: item.color });
                }}
              />
            ))}
          </div>
          <span className="memory-studio-rule" aria-hidden="true" />
          <div className="memory-studio-sizes memory-studio-text-sizes" aria-label="글자 크기">
            {WALL_TEXT_SIZES.map(size => (
              <button
                className={textSize === size ? "is-active" : ""}
                type="button"
                key={size}
                aria-pressed={textSize === size}
                aria-label={`${size}px`}
                title={`${size}px`}
                onClick={() => {
                  setTextSize(size);
                  if (selectedTextId) patchText(selectedTextId, { fontSize: size });
                }}
              >
                <span style={{ fontSize: Math.max(11, size * 0.42) }}>가</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <MemoryCanvasContext.Provider value={context}>
      {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}
      {syncError && <p role="alert" className="form-error">{syncError} <button type="button" onClick={() => {
        if (dirtyRef.current) flushRemoteSave();
        else retryRemoteRef.current();
      }}>다시 연결</button></p>}
      <div className={`memory-canvas ${styles.canvas} ${drawing || panning || tool === "text" ? `is-${tool}` : ""} ${spacePan ? "is-space" : ""}`}>
        <div
          ref={viewRef}
          className={`memory-canvas-viewport ${panning ? "is-panning" : ""} ${drawing ? `is-${tool}` : ""}`}
          role="region"
          tabIndex={0}
          aria-label="함께 꾸미는 추억 벽면"
          aria-describedby="memory-wall-hint"
          aria-busy={!ready}
          style={gridFill(camera)}
          onPointerDownCapture={event => {
            if (!ready || event.pointerType !== "touch" || (event.target as HTMLElement).closest("[contenteditable], [data-wall-controls]")) return;
            pointersRef.current.set(event.pointerId, viewPoint(event));
            if (pointersRef.current.size < 2) return;
            beginPinch(cameraRef.current);
            const view = viewRef.current;
            for (const pointerId of pointersRef.current.keys()) {
              try { view?.setPointerCapture(pointerId); } catch { /* A released touch is no longer capturable. */ }
            }
            event.stopPropagation();
          }}
          onPointerMoveCapture={event => {
            if (event.pointerType !== "touch") return;
            if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, viewPoint(event));
            if (!pinchRef.current) return;
            onPointerMove(event);
            event.stopPropagation();
          }}
          onPointerUpCapture={event => {
            if (event.pointerType !== "touch") return;
            if (pinchRef.current) { finishPointer(event); event.stopPropagation(); }
            else pointersRef.current.delete(event.pointerId);
          }}
          onPointerCancelCapture={event => {
            if (event.pointerType !== "touch") return;
            if (pinchRef.current) { finishPointer(event, true); event.stopPropagation(); }
            else pointersRef.current.delete(event.pointerId);
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={event => finishPointer(event)}
          onPointerCancel={event => finishPointer(event, true)}
          onContextMenu={event => event.preventDefault()}
        >
          <p id="memory-wall-hint" className="memory-canvas-hint">
            {tool === "select" && "사진은 끌어서 배치 · 빈 곳은 끌어서 이동"}
            {tool === "pan" && "끌어서 이동 · Ctrl / ⌘ + 휠로 확대"}
            {tool === "pen" && "사진 옆에 자유롭게 그려 보세요"}
            {tool === "marker" && "형광펜으로 장면 위에 표시를 남깁니다."}
            {tool === "eraser" && "획을 문질러 지우기 · 되돌리기로 복구"}
            {tool === "text" && "빈 곳을 눌러 글 쓰기 · 글을 두 번 누르면 수정"}
          </p>
          <div data-wall-controls className={styles.zoomControls} aria-label="벽면 확대와 축소" onPointerDown={event => event.stopPropagation()}>
            <button type="button" disabled={!ready || camera.zoom <= MIN_ZOOM} aria-label="벽면 축소" onClick={() => {
              const view = viewRef.current;
              if (view) setCamera(zoomAt(cameraRef.current, { x: view.clientWidth / 2, y: view.clientHeight / 2 }, 1 / 1.2));
            }}>−</button>
            <output aria-label="현재 확대 비율">{Math.round(camera.zoom * 100)}%</output>
            <button type="button" disabled={!ready || camera.zoom >= MAX_ZOOM} aria-label="벽면 확대" onClick={() => {
              const view = viewRef.current;
              if (view) setCamera(zoomAt(cameraRef.current, { x: view.clientWidth / 2, y: view.clientHeight / 2 }, 1.2));
            }}>+</button>
          </div>
          <div
            className="memory-canvas-world"
            style={{
              width: WORLD_W,
              height: WORLD_H,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            }}
          >
            <div className="memory-cork-stage">
              {children}
            </div>
            <div className="memory-wall-texts" aria-hidden={!texts.length}>
              {texts.map(item => (
                <div
                  key={item.id}
                  data-text-id={item.id}
                  role={editingTextId === item.id ? "group" : "button"}
                  tabIndex={ready && !drawing && !panning && editingTextId !== item.id ? 0 : -1}
                  aria-label={`벽면 글: ${item.text || "빈 글"}. Enter로 수정하고 방향키로 이동할 수 있어요.`}
                  aria-pressed={editingTextId === item.id ? undefined : selectedTextId === item.id}
                  onDoubleClick={() => { if (ready && !drawing && !panning) editText(item.id); }}
                  onKeyDown={event => {
                    if (!ready || editingTextId === item.id || drawing || panning) return;
                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); editText(item.id); }
                    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); removeText(item.id); }
                    const step = event.shiftKey ? 28 : 10;
                    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
                    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
                    if (dx || dy) { event.preventDefault(); selectText(item.id); patchText(item.id, { x: clamp(item.x + dx, 0, WORLD_W - 180), y: clamp(item.y + dy, 0, WORLD_H - 80) }); }
                  }}
                  title={session.mode === "authenticated" && item.authorId ? `${item.authorId === session.userId ? session.displayName : session.partner?.displayName ?? "파트너"}의 글` : undefined}
                  className={`memory-wall-text is-${item.fontFamily}${item.fontWeight === "bold" ? " is-bold" : ""}${item.authorId === userId ? " is-mine" : " is-partner"}${selectedTextId === item.id ? " is-selected" : ""}`}
                  style={{
                    left: item.x,
                    top: item.y,
                    zIndex: item.z,
                    color: item.color,
                    fontSize: item.fontSize,
                    transform: `rotate(${item.rotation}deg)`,
                  }}
                >
                  {editingTextId === item.id ? (
                    <span
                      role="textbox"
                      aria-label="추억에 남길 글"
                      data-placeholder="여기에 글을 남겨 주세요"
                      onPointerDown={event => event.stopPropagation()}
                      contentEditable="plaintext-only"
                      aria-multiline="true"
                      suppressContentEditableWarning
                      onInput={event => patchText(item.id, { text: (event.currentTarget.textContent || "").slice(0, 280) }, false)}
                      onBlur={event => {
                        const value = event.currentTarget.textContent?.trim() || "";
                        if (value) patchText(item.id, { text: value.slice(0, 280) }, false);
                        else {
                          const next = textsRef.current.filter(text => text.id !== item.id);
                          setTexts(next); persist({ texts: next }); setSelectedTextId(null);
                        }
                        if (textEditingBeforeRef.current) recordEdit(textEditingBeforeRef.current, boardSnapshot());
                        textEditingBeforeRef.current = null;
                        setEditingTextId(null);
                        flushRemoteSave();
                      }}
                      onKeyDown={event => {
                        event.stopPropagation();
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    >
                      {textEditingBeforeRef.current?.texts.find(text => text.id === item.id)?.text ?? ""}
                    </span>
                  ) : (
                    <><span>{item.text}</span><small className="memory-wall-author">{item.authorId === userId ? "나" : session.mode === "authenticated" ? session.partner?.displayName ?? "파트너" : "파트너"}</small></>
                  )}
                </div>
              ))}
            </div>
            <svg className="memory-ink" viewBox={`0 0 ${WORLD_W} ${WORLD_H}`} width={WORLD_W} height={WORLD_H} aria-hidden="true">
              {strokes.map(stroke => (
                <path
                  key={stroke.id}
                  d={stroke.path}
                  fill={stroke.color}
                  opacity={stroke.tool === "marker" ? 0.38 : 1}
                  style={stroke.tool === "marker" ? { mixBlendMode: "multiply" } : undefined}
                />
              ))}
              {livePath && (
                <path
                  d={livePath}
                  fill={color}
                  opacity={tool === "marker" ? 0.38 : 1}
                  style={tool === "marker" ? { mixBlendMode: "multiply" } : undefined}
                />
              )}
            </svg>
          </div>
        </div>
      </div>
    </MemoryCanvasContext.Provider>
  );
}
