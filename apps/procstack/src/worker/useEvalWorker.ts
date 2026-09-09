import { useEffect, useRef, useState } from "react";
import type { Geo } from "../geo/types";
import type { StackNode } from "../nodes/types";
import { createEvalWorker } from "./client";
import { CoalescingQueue } from "./coalesce";

/** スタックの評価を Worker に投げ、パラメータのドラッグ中もメインスレッドを固めない。 */
export function useEvalWorker(stack: StackNode[]): Geo | null {
  const [geo, setGeo] = useState<Geo | null>(null);
  const queueRef = useRef<CoalescingQueue<StackNode[], Geo | null> | null>(null);

  useEffect(() => {
    const { worker, api } = createEvalWorker();
    queueRef.current = new CoalescingQueue<StackNode[], Geo | null>((s) => api.evaluateStack(s));
    return () => {
      queueRef.current?.dispose();
      queueRef.current = null;
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    queueRef.current?.request(stack, setGeo);
  }, [stack]);

  return geo;
}
