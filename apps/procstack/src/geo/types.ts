export type TypedArray =
  | Float32Array
  | Uint32Array
  | Uint16Array
  | Uint8Array
  | Int32Array;

export interface Geo {
  points: Float32Array; // xyz
  indices: Uint32Array; // 三角形。点群だけの Geo では空
  attribs: {
    point: Record<string, TypedArray>; // N, Cd, pscale, up, orient など
    prim: Record<string, TypedArray>;
    detail: Record<string, unknown>;
  };
  groups: Record<string, Uint8Array>;
}
