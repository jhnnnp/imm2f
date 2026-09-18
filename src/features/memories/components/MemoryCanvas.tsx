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
import {
  readBoardState,
  writeBoardState,
  type CorkPose,
} from "../corkLayout";
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

export type CanvasTool = "select" | "pan" | "pen" | "marker" | "eraser";

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
    </svg>
  );
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
  const viewRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 0.42 });
  const posesRef = useRef(poses);
  const strokesRef = useRef<InkStroke[]>([]);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const panRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const pinchRef = useRef<{ camera: Camera; dist: number; world: { x: number; y: number } } | null>(null);
  const drawRef = useRef<{ pointerId: number; tool: InkTool | "eraser"; points: InkPoint[]; simulatePressure: boolean } | null>(null);
  const historyRef = useRef<InkStroke[][]>([]);
  const futureRef = useRef<InkStroke[][]>([]);
  const saveTimer = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const spaceRef = useRef(false);
  const loadedRef = useRef(false);
  const coupleIdRef = useRef(coupleId);
  coupleIdRef.current = coupleId;
  const [camera, setCameraState] = useState<Camera>(cameraRef.current);
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [color, setColor] = useState(INK_COLORS[0].color as string);
  const [penSize, setPenSize] = useState<number>(PEN_SIZES[1]);
  const [markerSize, setMarkerSize] = useState<number>(MARKER_SIZES[1]);
  const [livePath, setLivePath] = useState("");
  const [spacePan, setSpacePan] = useState(false);
  posesRef.current = poses;
  strokesRef.current = strokes;
  cameraRef.current = camera;

  const persist = useCallback((next?: { poses?: Record<string, CorkPose>; strokes?: InkStroke[]; camera?: Camera }) => {
    if (next?.poses) posesRef.current = next.poses;
    if (next?.strokes) strokesRef.current = next.strokes;
    if (next?.camera) cameraRef.current = next.camera;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      writeBoardState(coupleId, {
        v: 3,
        camera: cameraRef.current,
        poses: posesRef.current,
        strokes: strokesRef.current,
      });
    }, 80);
  }, [coupleId]);

  const setCamera = useCallback((update: Camera | ((current: Camera) => Camera)) => {
    setCameraState(current => {
      const next = typeof update === "function" ? update(current) : update;
      persist({ camera: next });
      return next;
    });
  }, [persist]);

  useEffect(() => {
    loadedRef.current = false;
    const board = readBoardState(coupleId);
    setPoses(board.poses);
    setStrokes(board.strokes);
    strokesRef.current = board.strokes;
    posesRef.current = board.poses;
    const applyCamera = () => {
      const view = viewRef.current?.getBoundingClientRect();
      const framed = view ? fitRect(view, contentRect(Object.values(board.poses))) : { x: 0, y: 0, zoom: 0.8 };
      const next = board.camera ?? framed;
      cameraRef.current = next;
      setCameraState(next);
    };
    applyCamera();
    const frame = window.requestAnimationFrame(() => {
      applyCamera();
      loadedRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [coupleId, setPoses]);

  useEffect(() => {
    if (!loadedRef.current) return;
    persist({ poses });
  }, [persist, poses]);

  useEffect(() => () => {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      writeBoardState(coupleIdRef.current, {
        v: 3,
        camera: cameraRef.current,
        poses: posesRef.current,
        strokes: strokesRef.current,
      });
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Space" && !event.repeat && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        spaceRef.current = true;
        setSpacePan(true);
        event.preventDefault();
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
  }, [persist]);

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
    </div>
  );

  return (
    <MemoryCanvasContext.Provider value={context}>
      {toolbarHost ? createPortal(toolbar, toolbarHost) : null}
      <div className={`memory-canvas ${drawing || panning ? `is-${tool}` : ""} ${spacePan ? "is-space" : ""}`}>
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
