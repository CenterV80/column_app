import type { NodeDef, ParamValues } from "./types";
import { box } from "./box";
import { grid } from "./grid";
import { transform } from "./transform";
import { attributeNoise } from "./attributeNoise";
import { polyextrude } from "./polyextrude";

export const NODES: Record<string, NodeDef> = { box, grid, transform, attributeNoise, polyextrude };

export function defaultParams(type: string): ParamValues {
  const out: ParamValues = {};
  for (const d of NODES[type].params) {
    out[d.k] = Array.isArray(d.def) ? [...d.def] : d.def;
  }
  return out;
}

export type { NodeDef, ParamDef, ParamValues, StackNode } from "./types";
