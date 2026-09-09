import type { Geo } from "../geo/types";

export interface ParamDef {
  k: string;
  label: string;
  type: "vec" | "float";
  def: number | number[];
  step: number;
  min?: number;
  max?: number;
  int?: boolean;
}

export type ParamValues = Record<string, number | number[]>;

export interface NodeDef {
  label: string;
  generator?: boolean;
  params: ParamDef[];
  compute: (inputs: (Geo | null)[], params: ParamValues) => Geo;
}

export interface StackNode {
  id: number;
  type: string;
  enabled: boolean;
  params: ParamValues;
}
