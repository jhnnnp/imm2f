"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import styles from "./ExpandableText.module.css";

/** Keep the original text intact; only its visible preview is shortened. */
export function ExpandableText({
  text,
  lines = 4,
  className = "",
  moreLabel = "전체보기",
  lessLabel = "접기",
  label,
}: {
  text: string;
  lines?: number;
  className?: string;
  moreLabel?: string;
  lessLabel?: string;
  label?: string;
}) {
  const contentId = useId();
  const previewLines = Number.isFinite(lines) ? Math.max(1, Math.floor(lines)) : 4;
  const probeRef = useRef<HTMLParagraphElement>(null);
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const [measured, setMeasured] = useState({ text: "", overflowing: false });
  const expanded = expandedText === text;
  const overflowing = measured.text === text && measured.overflowing;

  useEffect(() => {
    setExpandedText(null);
    const probe = probeRef.current;
    if (!probe) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const overflowing = probe.clientWidth > 0 && probe.scrollHeight > probe.clientHeight + 1;
      setMeasured(current => current.text === text && current.overflowing === overflowing
        ? current : { text, overflowing });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(probe);
    if (!observer) window.addEventListener("resize", measure);
    document.fonts?.addEventListener("loadingdone", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      active = false;
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", measure);
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [text, previewLines]);

  const previewStyle: CSSProperties = {
    display: "-webkit-box",
    WebkitLineClamp: previewLines,
    font: "inherit",
    lineHeight: "inherit",
    color: "inherit",
    margin: 0,
  };
  return (
    <div className={`${styles.root} ${className}`}>
      <p id={contentId} className={styles.text} style={{ ...previewStyle, display: expanded ? "block" : "-webkit-box" }}>{text}</p>
      <p ref={probeRef} aria-hidden="true" className={`${styles.text} ${styles.probe}`} style={previewStyle}>{text}</p>
      {overflowing && <button
        className={styles.toggle}
        type="button"
        draggable={false}
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={label ? `${label} ${expanded ? lessLabel : moreLabel}` : undefined}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); setExpandedText(expanded ? null : text); }}
      >{expanded ? lessLabel : moreLabel}<svg aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d={expanded ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} /></svg></button>}
    </div>
  );
}
