import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PointerEvent, RefObject } from "react";
import type { PageDownPos } from "../types";
import { savePageDownPos } from "../storage";

type Props = {
  streamRef: RefObject<HTMLElement | null>;
  pos: PageDownPos | null;
  onPos: (pos: PageDownPos) => void;
};

function clampPos(x: number, y: number): PageDownPos {
  const w = typeof window === "undefined" ? 400 : window.innerWidth;
  const h = typeof window === "undefined" ? 700 : window.innerHeight;
  return {
    x: Math.min(Math.max(8, x), Math.max(8, w - 72)),
    y: Math.min(Math.max(8, y), Math.max(8, h - 72)),
  };
}

function defaultPos(): PageDownPos {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  return clampPos(window.innerWidth - 88, window.innerHeight - 160);
}

export function PageDownButton({ streamRef, pos, onPos }: Props) {
  const dragging = useRef(false);
  const moved = useRef(false);
  const origin = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const [live, setLive] = useState<PageDownPos>(() => (pos ? clampPos(pos.x, pos.y) : defaultPos()));
  const liveRef = useRef<PageDownPos>(live);

  useEffect(() => {
    function fit() {
      setLive((current) => {
        const next = clampPos(current.x, current.y);
        liveRef.current = next;
        return next;
      });
    }
    window.addEventListener("resize", fit);
    fit();
    return () => window.removeEventListener("resize", fit);
  }, []);

  const left = live.x;
  const top = live.y;

  function pageDown() {
    const el = streamRef.current;
    if (!el) return;
    el.scrollBy({ top: Math.floor(el.clientHeight * 0.9), behavior: "smooth" });
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    dragging.current = true;
    moved.current = false;
    origin.current = { x: event.clientX, y: event.clientY, left, top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging.current) return;
    const dx = event.clientX - origin.current.x;
    const dy = event.clientY - origin.current.y;
    if (Math.hypot(dx, dy) > 8) moved.current = true;
    const next = clampPos(origin.current.left + dx, origin.current.top + dy);
    liveRef.current = next;
    setLive(next);
  }

  function onPointerUp() {
    dragging.current = false;
    const current = liveRef.current;
    if (moved.current && current) {
      onPos(current);
      savePageDownPos(current);
    } else {
      pageDown();
    }
  }

  return createPortal(
    <button
      type="button"
      className="page-down notranslate"
      translate="no"
      style={{ left, top }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label="Page Down"
    >
      ↓
    </button>,
    document.body,
  );
}
