const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.window = global;
require('../cards.js');
const CPU = require('../cpu-deck.js');
global.CPU_DECK = CPU;
require('../online-schema.js');
const CARD_DATA = global.CARD_DATA;
const expected = [
  [12, 3, 0, 54], [13, 2, 0, 20], [11, 4, 0, 17],
  [12, 2, 1, 4], [10, 5, 0, 3], [11, 3, 1, 2]
];

function makeRng(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

assert.deepEqual(CPU.RARITY_PATTERNS.map(pattern => [pattern.normal, pattern.rare, pattern.legend, pattern.weight]), expected);
const distribution = Array(expected.length).fill(0);
for (let i = 0; i < 10000; i++) {
  const selected = CPU.pickRarityPattern(() => (i + 0.5) / 10000);
  distribution[expected.findIndex(([normal, rare, legend]) => normal === selected.normal && rare === selected.rare && legend === selected.legend)]++;
}
assert.deepEqual(distribution, [5400, 2000, 1700, 400, 300, 200]);

const seen = new Set();
let repeats = 0;
for (let seed = 0; seed < 5000; seed++) {
  const rng = makeRng(seed);
  const generated = CPU.generateRoster(CARD_DATA, rng);
  const deal = global.OnlineRoomSchema.createOnlineDeal(`uid-${seed}`, CARD_DATA, makeRng(seed));
  assert.equal(generated.owned.length, 15);
  assert.equal(deal.cards.length, 15);
  assert.equal(new Set(deal.cards.map(card => card.instanceId)).size, 15);
  const counts = { normal: 0, rare: 0, legend: 0 };
  for (const card of deal.cards) counts[card.rarity]++;
  assert.deepEqual(counts, { normal: deal.normalCount, rare: deal.rareCount, legend: deal.legendCount });
  assert.equal(counts.normal + counts.rare + counts.legend, 15);
  assert.ok(counts.legend <= 1);
  assert.ok(expected.some(([n, r, l]) => n === counts.normal && r === counts.rare && l === counts.legend));
  seen.add(`${counts.normal}/${counts.rare}/${counts.legend}`);
  if (new Set(deal.cards.map(card => card.definitionId)).size < 15) repeats++;
  const byakko = deal.cards.find(card => card.definitionId === 'l-white-byakko');
  const selectedIds = byakko ? [byakko.instanceId] : deal.cards.slice(0, 5).map(card => card.instanceId);
  const formed = global.OnlineRoomSchema.createOnlineFormation(selectedIds, deal);
  assert.ok(formed, 'online formation accepts five distinct card instances, including repeated definitions');
}
assert.equal(seen.size, 6);
assert.ok(repeats > 0, 'duplicate card definitions are allowed in online deals');

for (let seed = 0; seed < 100; seed++) {
  const hostDeal = global.OnlineRoomSchema.createOnlineDeal(`host-${seed}`, CARD_DATA, makeRng(seed));
  const guestDeal = global.OnlineRoomSchema.createOnlineDeal(`guest-${seed}`, CARD_DATA, makeRng(seed + 1000));
  for (const [role, deal] of [['host', hostDeal], ['guest', guestDeal]]) {
    assert.equal(deal.cards.length, 15, `${role} receives 15 cards`);
    assert.equal(new Set(deal.cards.map(card => card.instanceId)).size, 15, `${role} gets distinct instance IDs`);
    const formationIds = deal.cards.slice(0, 5).map(card => card.instanceId);
    const formation = global.OnlineRoomSchema.createOnlineFormation(formationIds, deal);
    assert.ok(formation, `${role} can submit a valid formation from their private deal`);
  }
  assert.notEqual(hostDeal.cards[0].instanceId, guestDeal.cards[0].instanceId, 'host and guest deal instances remain separated');
}

const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'online-database.rules.json'), 'utf8')).rules;
assert.equal(rules['.read'], false);
assert.equal(rules['.write'], false);
const dealRules = rules.privateRoomData.$roomId.$uid.deal;
assert.ok(dealRules['.write'].includes("auth.uid === $uid") && dealRules['.write'].includes('!data.exists()'));
assert.ok(dealRules['.validate'].includes("newData.hasChildren(['normalCount','rareCount','legendCount','cards'])"));
assert.ok(dealRules['.validate'].includes("newData.child('legendCount').val() ==="));
assert.ok(dealRules.cards.$index.definitionId['.validate'].includes('l-red-suzaku') && dealRules.cards.$index.definitionId['.validate'].includes('l-white-byakko'));
assert.equal(dealRules.legendCount['.validate'], "newData.isNumber() && (newData.val() === 0 || newData.val() === 1)");
const onlineSource = fs.readFileSync(path.join(__dirname, '..', 'online.js'), 'utf8');
assert.ok(onlineSource.includes('runTransaction(dealRef, current => current == null ? generatedDeal : undefined'), 'host/guest race can only create the private deal once');
assert.ok(onlineSource.includes('const stored = await get(dealRef)'), 'the losing peer reads back the already-fixed Firebase deal');

console.log('Online deal tests: host/guest receive separate private rosters, the first Firebase transaction fixes the deal for both, all 15 slots and weights validate, duplicates are accepted, and access controls remain unchanged.');
