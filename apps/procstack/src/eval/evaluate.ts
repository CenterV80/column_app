import type { Geo } from "../geo/types";
import type { StackNode } from "../nodes/types";
import { NODES } from "../nodes";

/**
 * スタックを上から辿りながら type+enabled+params を連結した累積シグネチャを作り、
 * cache にヒットする限り手前のノードを再計算しない前方一致キャッシュ評価。
 */
export function evaluate(stack: StackNode[], cache: Map<string, Geo | null>): Geo | null {
  let geo: Geo | null = null;
  let sig = "";
  for (const node of stack) {
    sig += `|${node.type}#${node.enabled ? 1 : 0}#${JSON.stringify(node.params)}`;
    if (cache.has(sig)) {
      geo = cache.get(sig) ?? null;
      continue;
    }
    if (node.enabled) {
      const def = NODES[node.type];
      geo = def.generator ? def.compute([], node.params) : def.compute([geo], node.params);
    }
    cache.set(sig, geo);
  }
  return geo;
}
