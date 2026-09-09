import { useMemo, useRef } from "react";
import type { Geo } from "./geo/types";
import { geoStats } from "./geo/empty";
import { evaluate } from "./eval/evaluate";
import { useStackStore } from "./store/stackStore";
import { C } from "./theme";
import { Viewport } from "./viewport/Viewport";
import { StackList } from "./ui/StackList";
import { ParamsPanel } from "./ui/ParamsPanel";
import { Icon, P_FRAME } from "./ui/Icon";

export default function App() {
  const stack = useStackStore((s) => s.stack);
  const frameKey = useStackStore((s) => s.frameKey);
  const bumpFrame = useStackStore((s) => s.bumpFrame);
  const cache = useRef(new Map<string, Geo | null>());

  const geo = useMemo(() => {
    if (cache.current.size > 400) cache.current.clear();
    return evaluate(stack, cache.current);
  }, [stack]);

  const stats = geoStats(geo);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minHeight: "100vh",
        background: C.bg,
        color: C.text,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Viewport */}
      <div
        style={{
          position: "relative",
          flexShrink: 0,
          overflow: "hidden",
          height: "44vh",
          minHeight: 240,
          maxHeight: 420,
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        <Viewport geo={geo} frameKey={frameKey} />
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 10,
            fontSize: 11,
            color: C.dim,
            fontFamily: "ui-monospace, Menlo, monospace",
            pointerEvents: "none",
          }}
        >
          {stats.pt} points · {stats.prim} prims
        </div>
        <button
          onClick={bumpFrame}
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            background: "rgba(27,30,36,0.85)",
            border: `1px solid ${C.line}`,
            borderRadius: 6,
            color: C.dim,
            padding: 8,
            display: "flex",
            cursor: "pointer",
          }}
        >
          <Icon d={P_FRAME} size={16} />
        </button>
      </div>

      {/* Stack + Params */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <StackList />
        <ParamsPanel />
      </div>
    </div>
  );
}
