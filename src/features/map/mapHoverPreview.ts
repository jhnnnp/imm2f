export type MapHoverPreview = {
  kind: "place" | "memory" | "trip";
  tone: "want" | "visited" | "revisit" | "memory" | "trip";
  title: string;
  status: string;
  meta: string;
  detail?: string;
  image?: string | null;
};

type Bounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** Place the preview beside the actual HTML pin, including its collision offset. */
export function mapHoverPreviewPosition(host: Bounds, pin: Bounds, size: { width: number; height: number }) {
  const margin = 12;
  const gap = 12;
  const width = Math.min(size.width, Math.max(0, host.width - margin * 2));
  const height = Math.min(size.height, Math.max(0, host.height - margin * 2));
  const pinX = (pin.left + pin.right) / 2 - host.left;
  const pinTop = pin.top - host.top;
  const pinBottom = pin.bottom - host.top;
  const maxLeft = Math.max(margin, host.width - width - margin);
  const left = Math.min(maxLeft, Math.max(margin, pinX - width / 2));
  const placement = pinTop - gap - height >= margin ? "above" : "below";
  const desiredTop = placement === "above" ? pinTop - gap - height : pinBottom + gap;
  const top = Math.min(Math.max(margin, host.height - height - margin), Math.max(margin, desiredTop));
  const arrowX = Math.min(Math.max(18, width - 18), Math.max(18, pinX - left));
  return { left, top, arrowX, placement };
}

function previewImageUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "blob:" ? url.href : null;
  } catch {
    return null;
  }
}

let previewSequence = 0;

/** One accessible, hoverable tooltip per map; no MapLibre viewport mutations. */
export function createMapHoverPreview(host: HTMLElement, hoverDelay = 120) {
  const doc = host.ownerDocument;
  const tooltipId = `map-pin-preview-${++previewSequence}`;
  type Binding = { button: HTMLButtonElement; preview: MapHoverPreview; hovered: boolean; focused: boolean };
  let active: Binding | null = null;
  let pending: Binding | null = null;
  let tooltip: HTMLDivElement | null = null;
  let insidePreview = false;
  let destroyed = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanups = new Set<() => void>();

  const cancelOpen = () => { clearTimeout(openTimer); openTimer = undefined; pending = null; };
  const cancelClose = () => { clearTimeout(closeTimer); closeTimer = undefined; };
  const removeDescription = (button: HTMLButtonElement) => {
    const remaining = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(id => id && id !== tooltipId);
    if (remaining.length) button.setAttribute("aria-describedby", remaining.join(" "));
    else button.removeAttribute("aria-describedby");
  };
  const dismiss = () => {
    cancelOpen();
    cancelClose();
    if (active) {
      removeDescription(active.button);
      active.button.classList.remove("has-map-preview");
    }
    tooltip?.remove();
    tooltip = null;
    active = null;
    insidePreview = false;
  };
  const closeIfOutside = () => {
    cancelClose();
    if (!active || active.hovered || active.focused || insidePreview) return;
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      if (active && !active.hovered && !active.focused && !insidePreview) dismiss();
    }, 160);
  };
  const position = () => {
    if (!tooltip || !active) return;
    const next = mapHoverPreviewPosition(host.getBoundingClientRect(), active.button.getBoundingClientRect(), {
      width: tooltip.offsetWidth || 284,
      height: tooltip.offsetHeight || 136,
    });
    tooltip.style.left = `${next.left}px`;
    tooltip.style.top = `${next.top}px`;
    tooltip.style.setProperty("--preview-arrow-x", `${next.arrowX}px`);
    tooltip.dataset.placement = next.placement;
  };
  const show = (binding: Binding) => {
    cancelOpen();
    cancelClose();
    if (destroyed || !host.isConnected || !binding.button.isConnected) return;
    if (active === binding && tooltip) return;
    dismiss();
    active = binding;
    const preview = binding.preview;
    tooltip = doc.createElement("div");
    tooltip.id = tooltipId;
    tooltip.className = `map-pin-preview is-${preview.tone}`;
    tooltip.setAttribute("role", "tooltip");
    const card = doc.createElement("div");
    card.className = "map-pin-preview-card";
    const imageUrl = previewImageUrl(preview.image, doc.baseURI);
    if (imageUrl) {
      const image = doc.createElement("img");
      image.className = "map-pin-preview-image";
      image.src = imageUrl;
      image.alt = "";
      image.decoding = "async";
      image.addEventListener("error", () => { image.remove(); position(); }, { once: true });
      card.append(image);
    }
    const body = doc.createElement("div");
    body.className = "map-pin-preview-body";
    const text = (tag: "span" | "strong" | "p", className: string, value: string) => {
      const element = doc.createElement(tag);
      element.className = className;
      element.textContent = value;
      body.append(element);
    };
    text("span", "map-pin-preview-status", preview.status);
    text("strong", "map-pin-preview-title", preview.title);
    if (preview.meta) text("p", "map-pin-preview-meta", preview.meta);
    if (preview.detail) text("p", "map-pin-preview-detail", preview.detail);
    card.append(body);
    tooltip.append(card);
    const hint = doc.createElement("span");
    hint.className = "map-pin-preview-hint";
    hint.textContent = "클릭하거나 Enter를 눌러 자세히 보기";
    tooltip.append(hint);
    tooltip.addEventListener("pointerenter", () => { insidePreview = true; cancelClose(); });
    tooltip.addEventListener("pointerleave", () => { insidePreview = false; closeIfOutside(); });
    host.append(tooltip);
    const descriptions = new Set((binding.button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
    descriptions.add(tooltipId);
    binding.button.setAttribute("aria-describedby", [...descriptions].join(" "));
    binding.button.classList.add("has-map-preview");
    position();
  };
  const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
  doc.addEventListener("keydown", onEscape);

  return {
    dismiss,
    bind(button: HTMLButtonElement, preview: MapHoverPreview) {
      if (destroyed) return () => {};
      const binding: Binding = { button, preview, hovered: false, focused: false };
      let touchFocus = false;
      const onPointerDown = (event: PointerEvent) => { touchFocus = event.pointerType === "touch"; };
      const onEnter = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        binding.hovered = true;
        cancelOpen();
        cancelClose();
        pending = binding;
        openTimer = setTimeout(() => { openTimer = undefined; show(binding); }, hoverDelay);
      };
      const onLeave = () => {
        binding.hovered = false;
        if (pending === binding) cancelOpen();
        closeIfOutside();
      };
      const onFocus = () => { if (!touchFocus) { binding.focused = true; show(binding); } };
      const onBlur = () => {
        touchFocus = false;
        binding.focused = false;
        if (active === binding) closeIfOutside();
      };
      const onClick = () => dismiss();
      button.addEventListener("pointerdown", onPointerDown);
      button.addEventListener("pointerenter", onEnter);
      button.addEventListener("pointerleave", onLeave);
      button.addEventListener("focus", onFocus);
      button.addEventListener("blur", onBlur);
      button.addEventListener("click", onClick);
      const cleanup = () => {
        if (pending === binding || active === binding) dismiss();
        button.removeEventListener("pointerdown", onPointerDown);
        button.removeEventListener("pointerenter", onEnter);
        button.removeEventListener("pointerleave", onLeave);
        button.removeEventListener("focus", onFocus);
        button.removeEventListener("blur", onBlur);
        button.removeEventListener("click", onClick);
        cleanups.delete(cleanup);
      };
      cleanups.add(cleanup);
      return cleanup;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      dismiss();
      cleanups.forEach(cleanup => cleanup());
      doc.removeEventListener("keydown", onEscape);
    },
  };
}
