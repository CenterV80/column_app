import * as Comlink from "comlink";
import type { Geo } from "../geo/types";
import { cloneGeoForTransfer } from "../geo/transfer";
import { evaluate } from "../eval/evaluate";
import type { StackNode } from "../nodes/types";

const cache = new Map<string, Geo | null>();

function evaluateStack(stack: StackNode[]): Geo | null {
  if (cache.size > 400) cache.clear();
  const geo = evaluate(stack, cache);
  const { geo: transferGeo, buffers } = cloneGeoForTransfer(geo);
  return Comlink.transfer(transferGeo, buffers);
}

const api = { evaluateStack };
export type EvalWorkerApi = typeof api;

Comlink.expose(api);
