import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRuleFragment, printRuleFragment, ruleAt, setRule, ruleGroup } from '../lib/unit-rule-editor';

test('editing one nested weapon field preserves every sibling and instance', () => {
  const source = parseRuleFragment('Warhead@1Dam: SpreadDamage\n\tDamage: 15\n\tVersus:\n\t\tHeavy: 20\nWarhead@2Eff: CreateEffect\n\tImpactSounds: hit.aud\n');
  const next = setRule(source, ['Warhead@1Dam','Versus','Heavy'], '35');
  assert.equal(ruleAt(source, ['Warhead@1Dam','Versus','Heavy'])?.value, '20');
  assert.equal(ruleAt(next, ['Warhead@1Dam','Damage'])?.value, '15');
  assert.equal(ruleAt(next, ['Warhead@2Eff','ImpactSounds'])?.value, 'hit.aud');
  assert.deepEqual(parseRuleFragment(printRuleFragment(next)), next);
});
test('minimal overlays keep conditions, removals and escaped comment characters', () => {
  const nodes = parseRuleFragment('-Cloak:\nWithDecoration@FLAG:\n\tRequiresCondition: ready && !disabled\n\tText: tag\\#1\n');
  assert.equal(nodes[0].key, '-Cloak');
  assert.deepEqual(parseRuleFragment(printRuleFragment(nodes)), nodes);
  assert.equal(ruleGroup('ReloadDelayMultiplier@VETERAN'), 'Combat');
  assert.equal(ruleGroup('WithSpriteBody'), 'Art & audio');
  assert.equal(ruleGroup('Buildable'), 'Production');
});
