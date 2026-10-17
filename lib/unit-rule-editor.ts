import { parseMiniYaml } from './art-lab/miniyaml';
import type { RuleNode } from './unit-content-types';

export function parseRuleFragment(text: string): RuleNode[] {
  const convert = (n: ReturnType<typeof parseMiniYaml>[number]): RuleNode => ({ key: n.key, value: n.value.value, children: n.value.nodes.map(convert) });
  return parseMiniYaml(text).map(convert);
}
export function printRuleFragment(nodes: RuleNode[], depth = 0): string {
  return nodes.map(n => `${'\t'.repeat(depth)}${n.key}:${n.value === null ? '' : ` ${n.value.replaceAll('#', '\\#')}`}\n${printRuleFragment(n.children, depth + 1)}`).join('');
}
export function ruleAt(nodes: RuleNode[], path: string[]): RuleNode | undefined {
  const node = nodes.find(n => n.key === path[0]);
  return path.length === 1 ? node : ruleAt(node?.children ?? [], path.slice(1));
}
/** A minimal overlay; editing a leaf never rewrites its siblings or shared source. */
export function setRule(nodes: RuleNode[], path: string[], value: string | null): RuleNode[] {
  const next = structuredClone(nodes);
  let rows = next;
  path.forEach((key, i) => {
    let node = rows.find(n => n.key === key);
    if (!node) { node = { key, value: null, children: [] }; rows.push(node); }
    if (i === path.length - 1) node.value = value;
    rows = node.children;
  });
  return next;
}
export const ruleLabel = (text: string) => text.replace(/@/g, ' · ').replace(/([a-z])([A-Z])/g, '$1 $2');
export function ruleGroup(trait: string): string {
  if (/Buildable|Valued|Production|Prerequisite|TechTree|Tooltip|Selectable|ProvidesPrerequisite/.test(trait)) return 'Production';
  if (/Armament|Attack|Armor|Targetable|Warhead|Explod|Firepower|Reload|RangeMultiplier|DamageMultiplier|TakeCover/.test(trait)) return 'Combat';
  if (/Render|With|Voiced|Voice|Sound|BodyOrientation|Turreted|Palette/.test(trait)) return 'Art & audio';
  if (/Mobile|Aircraft|RevealsShroud|Health|Repair|HitShape|Positionable|Husk|Crush|Terrain|Occupy/.test(trait)) return 'Movement & defense';
  return 'Abilities';
}
export const corePaths = new Set(['Valued/Cost', 'Health/HP', 'Mobile/Speed', 'Aircraft/Speed']);
