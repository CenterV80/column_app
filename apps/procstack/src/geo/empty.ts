import type { Geo } from "./types";

export function emptyGeo(): Geo {
  return {
    points: new Float32Array(0),
    indices: new Uint32Array(0),
    attribs: { point: {}, prim: {}, detail: {} },
    groups: {},
  };
}

export function geoStats(geo: Geo | null) {
  if (!geo) return { pt: 0, prim: 0 };
  return { pt: geo.points.length / 3, prim: geo.indices.length / 3 };
}
