import { useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import type { PageDownPos } from "../types";
import { savePageDownPos } from "../storage";

type Props = {
  streamRef: RefObject<HTMLElement | null>;
  pos: PageDownPos | null;
  onPos: (pos: PageDownPos) => void;
};

export function PageDownButton({ streamRef, pos, onPos }: Props) {
  const dragging = useRef(false);
  const moved = useRef(false);
  const origin = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const liveRef = useRef<PageDownPos | null>(pos);
  const [live, setLive] = useState<PageDownPos | null>(pos);

  const left = live?.x ?? (typeof window !== "undefined" ? window.innerWidth - 88 : 24);
  const top = live?.y ?? (typeof window !== "undefined" ? window.innerHeight - 160 : 24);

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
    const next = {
      x: Math.min(window.innerWidth - 72, Math.max(8, origin.current.left + dx)),
      y: Math.min(window.innerHeight - 72, Math.max(8, origin.current.top + dy)),
    };
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

  return (
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
    </button>
  );
}
