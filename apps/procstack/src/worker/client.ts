import * as Comlink from "comlink";
import type { EvalWorkerApi } from "./eval.worker";

export function createEvalWorker() {
  const worker = new Worker(new URL("./eval.worker.ts", import.meta.url), { type: "module" });
  const api = Comlink.wrap<EvalWorkerApi>(worker);
  return { worker, api };
}
