import type { CSSProperties } from "react";
import { NODES } from "../nodes";
import { useStackStore } from "../store/stackStore";
import { C } from "../theme";
import { Icon, P_DOWN, P_EYE, P_EYE_OFF, P_PLUS, P_TRASH, P_UP } from "./Icon";

const btn: CSSProperties = {
  background: "transparent",
  border: "none",
  color: C.dim,
  padding: 6,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
};

export function StackList() {
  const stack = useStackStore((s) => s.stack);
  const selected = useStackStore((s) => s.selected);
  const adding = useStackStore((s) => s.adding);
  const select = useStackStore((s) => s.select);
  const addNode = useStackStore((s) => s.addNode);
  const removeNode = useStackStore((s) => s.removeNode);
  const toggleNode = useStackStore((s) => s.toggleNode);
  const moveNode = useStackStore((s) => s.moveNode);
  const setAdding = useStackStore((s) => s.setAdding);

  return (
    <div style={{ padding: "8px 10px" }}>
      {stack.map((node, i) => {
        const isSel = node.id === selected;
        return (
          <div key={node.id} style={{ display: "flex", alignItems: "center", position: "relative" }}>
            {/* 流れを示す縦線 */}
            <div
              style={{
                position: "absolute",
                left: 7,
                top: 0,
                bottom: 0,
                width: 1,
                background: C.line,
                display: i === stack.length - 1 ? "none" : "block",
              }}
            />
            <div
              style={{
                width: 15,
                height: 15,
                borderRadius: 8,
                flexShrink: 0,
                zIndex: 1,
                border: `1px solid ${node.enabled ? C.dim : C.line}`,
                background: node.enabled ? C.bg : "transparent",
              }}
            />
            <div
              onClick={() => select(node.id)}
              style={{
                flex: 1,
                marginLeft: 8,
                marginBottom: 4,
                padding: "9px 10px",
                borderRadius: 6,
                cursor: "pointer",
                background: isSel ? C.panel2 : C.panel,
                borderLeft: `2px solid ${isSel ? C.accent : "transparent"}`,
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: node.enabled ? 1 : 0.42,
              }}
            >
              <span style={{ fontSize: 14, flex: 1 }}>{NODES[node.type].label}</span>
              {isSel && (
                <>
                  <button
                    style={btn}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveNode(node.id, -1);
                    }}
                  >
                    <Icon d={P_UP} />
                  </button>
                  <button
                    style={btn}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveNode(node.id, 1);
                    }}
                  >
                    <Icon d={P_DOWN} />
                  </button>
                </>
              )}
              <button
                style={btn}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleNode(node.id);
                }}
              >
                <Icon d={node.enabled ? P_EYE : P_EYE_OFF} />
              </button>
              <button
                style={btn}
                onClick={(e) => {
                  e.stopPropagation();
                  removeNode(node.id);
                }}
              >
                <Icon d={P_TRASH} />
              </button>
            </div>
          </div>
        );
      })}

      <div style={{ marginLeft: 23, marginTop: 4 }}>
        {adding ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(NODES).map(([k, v]) => (
              <button
                key={k}
                onClick={() => addNode(k)}
                style={{
                  background: C.panel2,
                  border: `1px solid ${C.line}`,
                  color: C.text,
                  borderRadius: 6,
                  padding: "8px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {v.label}
              </button>
            ))}
            <button
              onClick={() => setAdding(false)}
              style={{ background: "transparent", border: "none", color: C.dim, padding: "8px 10px", fontSize: 13, cursor: "pointer" }}
            >
              やめる
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              background: "transparent",
              border: `1px dashed ${C.line}`,
              color: C.dim,
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon d={P_PLUS} size={13} /> ノードを追加
          </button>
        )}
      </div>
    </div>
  );
}
