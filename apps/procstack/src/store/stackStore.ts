import { create } from "zustand";
import type { StackNode, ParamValues } from "../nodes/types";
import { defaultParams } from "../nodes";

let uid = 1;

interface StackState {
  stack: StackNode[];
  selected: number | null;
  adding: boolean;
  frameKey: number;
  addNode: (type: string) => void;
  removeNode: (id: number) => void;
  toggleNode: (id: number) => void;
  moveNode: (id: number, dir: 1 | -1) => void;
  setParam: (id: number, k: string, v: ParamValues[string]) => void;
  select: (id: number) => void;
  setAdding: (v: boolean) => void;
  bumpFrame: () => void;
}

export const useStackStore = create<StackState>((set) => ({
  stack: [
    { id: uid++, type: "box", enabled: true, params: defaultParams("box") },
    { id: uid++, type: "transform", enabled: true, params: defaultParams("transform") },
  ],
  selected: 1,
  adding: false,
  frameKey: 0,

  addNode: (type) =>
    set((s) => {
      const node: StackNode = { id: uid++, type, enabled: true, params: defaultParams(type) };
      return { stack: [...s.stack, node], selected: node.id, adding: false };
    }),

  removeNode: (id) => set((s) => ({ stack: s.stack.filter((n) => n.id !== id) })),

  toggleNode: (id) =>
    set((s) => ({
      stack: s.stack.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n)),
    })),

  moveNode: (id, dir) =>
    set((s) => {
      const i = s.stack.findIndex((n) => n.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.stack.length) return s;
      const c = [...s.stack];
      [c[i], c[j]] = [c[j], c[i]];
      return { stack: c };
    }),

  setParam: (id, k, v) =>
    set((s) => ({
      stack: s.stack.map((n) => (n.id === id ? { ...n, params: { ...n.params, [k]: v } } : n)),
    })),

  select: (id) => set({ selected: id }),
  setAdding: (v) => set({ adding: v }),
  bumpFrame: () => set((s) => ({ frameKey: s.frameKey + 1 })),
}));
