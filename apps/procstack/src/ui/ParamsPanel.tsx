import { NODES } from "../nodes";
import { useStackStore } from "../store/stackStore";
import { C } from "../theme";
import { ParamRow } from "./ParamRow";

export function ParamsPanel() {
  const stack = useStackStore((s) => s.stack);
  const selected = useStackStore((s) => s.selected);
  const setParam = useStackStore((s) => s.setParam);

  const sel = stack.find((n) => n.id === selected);

  return (
    <div style={{ padding: "12px 14px 48px", minHeight: 200, borderTop: `1px solid ${C.line}`, background: C.panel }}>
      {sel ? (
        <>
          <div style={{ fontSize: 13, color: C.text, marginBottom: 12 }}>{NODES[sel.type].label}</div>
          {NODES[sel.type].params.map((d) => (
            <ParamRow key={d.k} def={d} value={sel.params[d.k]} onChange={(v) => setParam(sel.id, d.k, v)} />
          ))}
          <div style={{ fontSize: 11, color: C.dim, marginTop: 16, lineHeight: 1.6 }}>数値は横にドラッグ。長押しでキーボード入力。</div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: C.dim }}>ノードを選ぶとパラメータが出ます。</div>
      )}
    </div>
  );
}
