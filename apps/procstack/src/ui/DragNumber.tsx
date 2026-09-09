import { useEffect, useRef, useState } from "react";
import { C } from "../theme";

interface DragState {
  x: number;
  start: number;
  moved: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface DragNumberProps {
  value: number;
  step: number;
  int?: boolean;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  tint?: string;
}

/** 横ドラッグで変更 / 長押しでキーボード入力 */
export function DragNumber({ value, step, int, min, max, onChange, tint }: DragNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(false);
  const drag = useRef<DragState | null>(null);

  // ドラッグ中に親が再レンダリングされても最新を掴めるよう ref 経由にする
  const latest = useRef({ value, step, int, min, max, onChange });
  latest.current = { value, step, int, min, max, onChange };

  const clamp = (v: number) => {
    const L = latest.current;
    if (L.min !== undefined) v = Math.max(L.min, v);
    if (L.max !== undefined) v = Math.min(L.max, v);
    return L.int ? Math.round(v) : Math.round(v * 1000) / 1000;
  };

  useEffect(() => {
    if (!active) return;
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) > 3) {
        d.moved = true;
        clearTimeout(d.timer);
      }
      const L = latest.current;
      const next = L.int ? d.start + Math.round(dx / 10) * L.step : d.start + dx * L.step * 0.5;
      L.onChange(clamp(next));
    };
    const onEnd = () => {
      if (drag.current) clearTimeout(drag.current.timer);
      drag.current = null;
      setActive(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [active]);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = {
      x: e.clientX,
      start: latest.current.value,
      moved: false,
      timer: setTimeout(() => {
        const d = drag.current;
        if (d && !d.moved) {
          setDraft(String(latest.current.value));
          setEditing(true);
          drag.current = null;
          setActive(false);
        }
      }, 450),
    };
    setActive(true);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseFloat(draft);
          if (!isNaN(v)) onChange(clamp(v));
          setEditing(false);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        style={{
          width: "100%",
          background: C.bg,
          color: C.accent,
          border: `1px solid ${C.accent}`,
          borderRadius: 4,
          padding: "7px 8px",
          fontSize: 14,
          fontVariantNumeric: "tabular-nums",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          outline: "none",
        }}
      />
    );
  }

  return (
    <div
      onPointerDown={onDown}
      style={{
        flex: 1,
        minWidth: 0,
        textAlign: "center",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
        cursor: "ew-resize",
        padding: "7px 4px",
        borderRadius: 4,
        background: active ? "#2A2F38" : C.panel2,
        border: `1px solid ${active ? C.accent : C.line}`,
        color: active ? C.accent : tint || C.text,
        fontSize: 14,
        fontVariantNumeric: "tabular-nums",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {int ? value : value.toFixed(2)}
    </div>
  );
}
