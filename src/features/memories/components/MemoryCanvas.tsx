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
import {
  isBoardEmpty,
  mergeWallBoard,
  readBoardState,
  writeBoardState,
  writeBoardSyncedAt,
  type CorkBoardState,
  type CorkPose,
} from "../corkLayout";
import { saveMemoryWallBoard, loadMemoryWallBoard } from "../wallBoardActions";
import { subscribeMemoryWallBoard } from "../wallBoardLive";
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
  const viewRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 0.42 });
  const posesRef = useRef(poses);
  const strokesRef = useRef<InkStroke[]>([]);
  const textsRef = useRef<WallText[]>([]);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const panRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const pinchRef = useRef<{ camera: Camera; dist: number; world: { x: number; y: number } } | null>(null);
  const drawRef = useRef<{ pointerId: number; tool: InkTool | "eraser"; points: InkPoint[]; simulatePressure: boolean } | null>(null);
  const textDragRef = useRef<{ pointerId: number; id: string; lastX: number; lastY: number } | null>(null);
  const historyRef = useRef<InkStroke[][]>([]);
  const futureRef = useRef<InkStroke[][]>([]);
  const saveTimer = useRef<number | null>(null);
  const remoteSaveTimer = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const spaceRef = useRef(false);
  const loadedRef = useRef(false);
  const applyingRemoteRef = useRef(false);
  const lastSelfSaveAtRef = useRef(0);
  const coupleIdRef = useRef(coupleId);
  coupleIdRef.current = coupleId;
  const [camera, setCameraState] = useState<Camera>(cameraRef.current);
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
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
  cameraRef.current = camera;

  const boardSnapshot = useCallback((): CorkBoardState => ({
    v: 4,
    camera: cameraRef.current,
    poses: posesRef.current,
    strokes: strokesRef.current,
    texts: textsRef.current,
  }), []);

  const flushRemoteSave = useCallback((state: CorkBoardState) => {
    if (remoteSaveTimer.current) window.clearTimeout(remoteSaveTimer.current);
    remoteSaveTimer.current = window.setTimeout(() => {
      lastSelfSaveAtRef.current = Date.now();
      void saveMemoryWallBoard(state).then(result => {
        if ("ok" in result) writeBoardSyncedAt(coupleIdRef.current, result.updatedAt);
      });
    }, 420);
  }, []);

  const persist = useCallback((next?: { poses?: Record<string, CorkPose>; strokes?: InkStroke[]; texts?: WallText[]; camera?: Camera }) => {
    if (next?.poses) posesRef.current = next.poses;
    if (next?.strokes) strokesRef.current = next.strokes;
    if (next?.texts) textsRef.current = next.texts;
    if (next?.camera) cameraRef.current = next.camera;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const state = boardSnapshot();
      writeBoardState(coupleId, state);
      if (!applyingRemoteRef.current) flushRemoteSave(state);
    }, 80);
  }, [boardSnapshot, coupleId, flushRemoteSave]);

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

  const patchText = useCallback((id: string, patch: Partial<WallText>) => {
    const next = textsRef.current.map(item => (item.id === id ? { ...item, ...patch } : item));
    setTexts(next);
    persist({ texts: next });
  }, [persist]);

  const removeText = useCallback((id: string) => {
    const next = textsRef.current.filter(item => item.id !== id);
    setTexts(next);
    setSelectedTextId(current => (current === id ? null : current));
    setEditingTextId(current => (current === id ? null : current));
    persist({ texts: next });
  }, [persist]);

  const setCamera = useCallback((update: Camera | ((current: Camera) => Camera)) => {
    setCameraState(current => {
      const next = typeof update === "function" ? update(current) : update;
      persist({ camera: next });
      return next;
    });
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    const local = readBoardState(coupleId);

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
        applyCamera();
        loadedRef.current = true;
      });
    };

    void loadMemoryWallBoard().then(({ state: remote, updatedAt }) => {
      if (cancelled) return;
      const merged = mergeWallBoard(local, remote, updatedAt, coupleId);
      applyBoard(merged);
      writeBoardState(coupleId, merged);
      if (updatedAt) writeBoardSyncedAt(coupleId, updatedAt);
      finishCamera(merged);
      if ((!remote || isBoardEmpty(remote)) && !isBoardEmpty(local)) {
        void saveMemoryWallBoard(local).then(result => {
          if ("ok" in result) writeBoardSyncedAt(coupleId, result.updatedAt);
        });
      }
    }).catch(() => {
      if (cancelled) return;
      applyBoard(local);
      finishCamera(local);
    });

    const live = subscribeMemoryWallBoard(coupleId, (remote, updatedAt, updatedBy) => {
      if (cancelled) return;
      if (updatedBy && userId && updatedBy === userId && Date.now() - lastSelfSaveAtRef.current < 1200) {
        return;
      }
      if (drawRef.current || textDragRef.current) return;
      applyingRemoteRef.current = true;
      applyBoard(remote);
      writeBoardState(coupleId, remote);
      writeBoardSyncedAt(coupleId, updatedAt);
      applyingRemoteRef.current = false;
    });

    let poll: number | undefined;
    void live.connected.then(connected => {
      if (cancelled || connected) return;
      poll = window.setInterval(() => {
        void loadMemoryWallBoard().then(({ state: remote, updatedAt }) => {
          if (cancelled || !remote || drawRef.current) return;
          const merged = mergeWallBoard(readBoardState(coupleId), remote, updatedAt, coupleId);
          applyingRemoteRef.current = true;
          applyBoard(merged);
          writeBoardState(coupleId, merged);
          if (updatedAt) writeBoardSyncedAt(coupleId, updatedAt);
          applyingRemoteRef.current = false;
        });
      }, 5000);
    });

    return () => {
      cancelled = true;
      live.unsubscribe();
      if (poll) window.clearInterval(poll);
    };
  }, [applyBoard, coupleId, userId]);

  useEffect(() => {
    if (!loadedRef.current) return;
    persist({ poses });
  }, [persist, poses]);

  useEffect(() => () => {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (remoteSaveTimer.current) window.clearTimeout(remoteSaveTimer.current);
    const state = {
      v: 4 as const,
      camera: cameraRef.current,
      poses: posesRef.current,
      strokes: strokesRef.current,
      texts: textsRef.current,
    };
    writeBoardState(coupleIdRef.current, state);
    void saveMemoryWallBoard(state);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Space" && !event.repeat && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        spaceRef.current = true;
        setSpacePan(true);
        event.preventDefault();
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selectedTextId && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.isContentEditable) return;
        event.preventDefault();
        removeText(selectedTextId);
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          const next = futureRef.current.pop();
          if (!next) return;
          historyRef.current.push(strokesRef.current);
          setStrokes(next);
          persist({ strokes: next });
          return;
        }
        const prev = historyRef.current.pop();
        if (!prev) return;
        futureRef.current.push(strokesRef.current);
        setStrokes(prev);
        persist({ strokes: prev });
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        spaceRef.current = false;
        setSpacePan(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [persist, removeText, selectedTextId]);

  useEffect(() => {
    const node = viewRef.current;
    if (!node) return;
    function onWheel(event: WheelEvent) {
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
  }, [setCamera]);

  const drawing = tool === "pen" || tool === "marker" || tool === "eraser";
  const panning = tool === "pan" || spacePan;
  const interactive = tool === "select" && !spacePan;

  useEffect(() => {
    if (!editingTextId) return;
    const node = viewRef.current?.querySelector(`[data-text-id="${editingTextId}"] [contenteditable="true"]`) as HTMLElement | null;
    if (!node) return;
    node.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [editingTextId, texts]);

  function applyInk(next: InkStroke[], historic: boolean) {
    if (historic) {
      historyRef.current = [...historyRef.current.slice(-39), strokesRef.current];
      futureRef.current = [];
    }
    setStrokes(next);
    persist({ strokes: next });
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
    const pressure = event.pressure > 0 ? event.pressure : 0.5;
    return [world.x, world.y, pressure];
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
    drawRef.current = null;
    setLivePath("");
    const mid = pointerMid();
    pinchRef.current = {
      camera: cameraNow,
      dist: Math.max(1, pointerDistance()),
      world: screenToWorld(cameraNow, mid),
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
    }
    const view = viewRef.current;
    if (!view) return;
    const point = viewPoint(event);
    pointersRef.current.set(event.pointerId, point);
    try {
      view.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (pointersRef.current.size === 2) {
      beginPinch(cameraRef.current);
      return;
    }
    const textHit = (event.target as HTMLElement).closest(".memory-wall-text") as HTMLElement | null;
    const textId = textHit?.dataset.textId;
    if (textId && (tool === "select" || tool === "text") && event.button === 0) {
      setSelectedTextId(textId);
      if (tool === "text") setEditingTextId(textId);
      if (tool === "select") {
        textDragRef.current = { pointerId: event.pointerId, id: textId, lastX: event.clientX, lastY: event.clientY };
      }
      return;
    }
    if (tool === "text" && event.button === 0) {
      const world = screenToWorld(cameraRef.current, viewPoint(event));
      const created = createWallText({
        x: world.x,
        y: world.y,
        z: nextTextLayerZ(posesRef.current, textsRef.current),
        color: textColor,
        fontFamily: textFont,
        fontWeight: textWeight,
        fontSize: textSize,
      });
      const next = [...textsRef.current, created];
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
    drawRef.current = {
      pointerId: event.pointerId,
      tool: tool === "eraser" ? "eraser" : tool,
      points: [point3],
      simulatePressure: event.pointerType !== "mouse",
    };
    if (tool === "eraser") {
      commitStrokes(eraseStrokes(strokesRef.current, point3[0], point3[1], size));
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
      const scale = cameraRef.current.zoom || 1;
      const dx = (event.clientX - textDrag.lastX) / scale;
      const dy = (event.clientY - textDrag.lastY) / scale;
      textDrag.lastX = event.clientX;
      textDrag.lastY = event.clientY;
      const origin = textsRef.current.find(item => item.id === textDrag.id);
      if (!origin) return;
      patchText(textDrag.id, { x: origin.x + dx, y: origin.y + dy });
      return;
    }
    const draw = drawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) return;
    const point = inkPoint(event, cameraRef.current);
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

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
    if (textDragRef.current?.pointerId === event.pointerId) textDragRef.current = null;
    const view = viewRef.current;
    if (view?.hasPointerCapture(event.pointerId)) view.releasePointerCapture(event.pointerId);
    const draw = drawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) return;
    drawRef.current = null;
    setLivePath("");
    if (draw.tool === "eraser" || draw.points.length < 1) return;
    commitStrokes([...strokesRef.current, createInkStroke({
      tool: draw.tool,
      color,
      size: draw.tool === "marker" ? markerSize : penSize,
      points: draw.points,
      simulatePressure: draw.simulatePressure,
    })]);
  }

  function fitView() {
    const view = viewRef.current?.getBoundingClientRect();
    if (!view) return;
    setCamera(fitRect(view, contentRect(Object.values(posesRef.current))));
  }

  const context = useMemo<CanvasContextValue>(() => ({ zoom: camera.zoom, interactive }), [camera.zoom, interactive]);
  const inkSizes = tool === "marker" ? MARKER_SIZES : PEN_SIZES;
  const activeSize = tool === "marker" ? markerSize : penSize;
  const toolbar = (
    <div className="memory-studio-bar">
      <div className="memory-studio-main">
        <div className="memory-studio-group" role="toolbar" aria-label="벽면 도구">
          {TOOLS.map(item => (
            <button
              className={`memory-studio-tool ${tool === item.id ? "is-active" : ""}`}
              type="button"
              key={item.id}
              aria-pressed={tool === item.id}
              aria-label={item.label}
              onClick={() => setTool(item.id)}
            >
              <StudioIcon name={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="memory-studio-actions">
          <button className="memory-studio-action" type="button" onClick={fitView}>화면 맞추기</button>
          <button className="memory-studio-action" type="button" onClick={() => commitStrokes([])} disabled={!strokes.length}>필기 지우기</button>
          <button className="memory-studio-action" type="button" onClick={onScatter}>흩뿌리기</button>
          <button className="memory-studio-action" type="button" onClick={onReset}>가지런히</button>
        </div>
      </div>
      {(tool === "pen" || tool === "marker") && (
        <div className="memory-studio-ink">
          <div className="memory-studio-swatches" aria-label="잉크 색">
            {INK_COLORS.map(item => (
              <button
                className={color === item.color ? "is-active" : ""}
                type="button"
                key={item.id}
                aria-label={item.label}
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
      {tool === "text" && (
        <div className="memory-studio-ink">
          <div className="memory-studio-fonts" aria-label="글꼴">
            <button
              className={textFont === "hand" ? "is-active" : ""}
              type="button"
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
      {toolbarHost ? createPortal(toolbar, toolbarHost) : null}
      <div className={`memory-canvas ${drawing || panning || tool === "text" ? `is-${tool}` : ""} ${spacePan ? "is-space" : ""}`}>
        <div
          ref={viewRef}
          className={`memory-canvas-viewport ${panning ? "is-panning" : ""} ${drawing ? `is-${tool}` : ""}`}
          role="application"
          aria-label="추억 종이. 펜으로 그리고 두 손가락으로 확대합니다."
          style={gridFill(camera)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={event => event.preventDefault()}
        >
          <p className="memory-canvas-hint">
            {tool === "select" && "사진을 옮기고 각도를 틀 수 있어요. 빈 곳을 끌거나 스페이스로 종이를 밀고, 트랙패드는 두 손가락으로 확대합니다."}
            {tool === "pan" && "종이를 밀어 이동합니다. 휠은 이동, Ctrl 휠은 확대입니다."}
            {tool === "pen" && "펜으로 벡터 획을 남깁니다. 두 손가락이나 스페이스로 종이를 움직일 수 있어요."}
            {tool === "marker" && "형광펜으로 장면 위에 표시를 남깁니다."}
            {tool === "eraser" && "획을 문질러 지웁니다. Ctrl+Z로 되돌릴 수 있어요."}
            {tool === "text" && "사진 위 아무 곳이나 눌러 글을 남기세요. 선택 도구로 옮기고, Delete로 지울 수 있어요."}
          </p>
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
                  className={`memory-wall-text is-${item.fontFamily}${item.fontWeight === "bold" ? " is-bold" : ""}${selectedTextId === item.id ? " is-selected" : ""}`}
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
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={event => {
                        const value = event.currentTarget.textContent?.trim() || "우리의 한 줄";
                        patchText(item.id, { text: value.slice(0, 280) });
                        setEditingTextId(null);
                      }}
                      onKeyDown={event => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    >
                      {item.text}
                    </span>
                  ) : (
                    <span>{item.text}</span>
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
