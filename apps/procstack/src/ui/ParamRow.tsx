import type { ParamDef, ParamValues } from "../nodes/types";
import { C, AXIS } from "../theme";
import { DragNumber } from "./DragNumber";

interface ParamRowProps {
  def: ParamDef;
  value: ParamValues[string];
  onChange: (v: ParamValues[string]) => void;
}

export function ParamRow({ def, value, onChange }: ParamRowProps) {
  const isVec = def.type === "vec";
  const arr = isVec ? (value as number[]) : [value as number];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 5 }}>{def.label}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {arr.map((v, i) => (
          <DragNumber
            key={i}
            value={v}
            step={def.step}
            int={def.int}
            min={def.min}
            max={def.max}
            tint={isVec && arr.length === 3 ? AXIS[i] : undefined}
            onChange={(nv) => {
              if (isVec) {
                const copy = [...arr];
                copy[i] = nv;
                onChange(copy);
              } else onChange(nv);
            }}
          />
        ))}
      </div>
    </div>
  );
}
