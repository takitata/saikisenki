const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
global.window = global;
require("../cards.js");
require("../battle.js");
require("../online-schema.js");

const cards = global.CARD_DATA;
const schema = global.OnlineRoomSchema;
const engine = global.BattleEngine;
const core = require('../online-battle-core.js');
const byId = new Map(cards.map(card => [card.id, card]));
assert.equal(cards.length, 56);
assert.deepEqual(cards.reduce((counts, card) => (counts[card.rarity]++, counts), {normal:0,rare:0,legend:0}), {normal:40,rare:12,legend:4});

for (const [rarity, role] of [["normal","host"],["rare","guest"],["legend","host"]]) {
  const definition = cards.find(card => card.rarity === rarity);
  const deal = schema.createFreeDeckDeal(`uid-${role}`, role, Array(15).fill(definition.id), cards);
  assert.ok(deal);
  assert.equal(deal.cards.length, 15);
  assert.equal(new Set(deal.cards.map(card => card.instanceId)).size, 15, `${rarity} duplicate copies have distinct instance IDs`);
  assert.ok(deal.cards.every(card => card.definitionId === definition.id && card.rarity === rarity));
  assert.equal(deal.normalCount, rarity === "normal" ? 15 : 0);
  assert.equal(deal.rareCount, rarity === "rare" ? 15 : 0);
  assert.equal(deal.legendCount, rarity === "legend" ? 15 : 0);
  assert.equal(schema.validateOnlineDeal(deal, cards, "free", `uid-${role}`, role), true);
  assert.equal(schema.createOnlineFormation(deal.cards.slice(0,5).map(card=>card.instanceId), deal) !== null, definition.formationRestriction?.exclusive !== true);
}

const legendByakko = cards.find(card => card.id === "l-white-byakko");
const mixedByakko = schema.createFreeDeckDeal("uid-host", "host", [legendByakko.id, cards[0].id, ...Array(13).fill(cards[1].id)], cards);
assert.equal(schema.createOnlineFormation([mixedByakko.cards[0].instanceId, mixedByakko.cards[1].instanceId], mixedByakko), null, "Byakko cannot be paired with another battle card");
assert.ok(schema.createOnlineFormation([mixedByakko.cards[0].instanceId], mixedByakko), "Byakko is valid as a solo battle roster");

assert.equal(schema.createFreeDeckDeal("uid-host", "host", Array(14).fill(cards[0].id), cards), null, "14 cards cannot be confirmed");assert.equal(schema.createFreeDeckDeal("uid-host", "host", Array(16).fill(cards[0].id), cards), null, "more than 15 cards cannot be confirmed");
const valid = schema.createFreeDeckDeal("uid-host", "host", Array(15).fill(cards[0].id), cards);
const malformed = structuredClone(valid);
malformed.cards[1].instanceId = malformed.cards[0].instanceId;
assert.equal(schema.validateOnlineDeal(malformed, cards, "free", "uid-host", "host"), false, "duplicate instance IDs are rejected");
const wrongRarity = structuredClone(valid); wrongRarity.cards[0].rarity = "rare";
assert.equal(schema.validateOnlineDeal(wrongRarity, cards, "free", "uid-host", "host"), false, "rarity must match card definition");
assert.equal(schema.validateOnlineDeal(valid, cards, "random", "uid-host", "host"), false, "free deal cannot be used in a random room");

const hostDeal = schema.createFreeDeckDeal("host-uid", "host", Array(15).fill("n-green-healer"), cards);
const guestDeal = schema.createFreeDeckDeal("guest-uid", "guest", Array(15).fill("n-red-warrior"), cards);
const hostMirror = core.makeMatch(engine, {ownOwned:hostDeal.cards, ownBattleIds:hostDeal.cards.slice(0,2).map(item=>item.instanceId), opponentBattle:guestDeal.cards.slice(0,2), cardMap:byId, localRole:"host"});
const guestMirror = core.makeMatch(engine, {ownOwned:guestDeal.cards, ownBattleIds:guestDeal.cards.slice(0,2).map(item=>item.instanceId), opponentBattle:hostDeal.cards.slice(0,2), cardMap:byId, localRole:"guest"});
assert.deepEqual(core.snapshot(hostMirror,"host"),core.snapshot(guestMirror,"guest"),"free duplicated rosters produce host/guest-identical initial battle snapshots");
const roster = Array.from({length:15}, (_,index)=>({instanceId:`host-free-${String(index).padStart(2,"0")}`,cardId:index===2?"n-green-treant":"n-green-healer"}));
const match = engine.createMatch({playerOwned:roster,playerOrder:roster.slice(0,2).map(item=>item.instanceId),cpuOwned:[{instanceId:"cpu-one",cardId:"n-red-warrior"}],cpuOrder:["cpu-one"],cardMap:byId});
assert.equal(match.player.battleCards.length, 2, "two copies of one definition are separate battle units");
match.player.battleCards[0].currentHp = 1;
assert.equal(match.player.battleCards[1].currentHp, match.player.battleCards[1].maxHp, "changing one copy's HP leaves the other untouched");
match.player.battleCards[1].currentHp -= 12;
engine.applySupport(match,"player",roster[2].instanceId,{switchTargetId:roster[1].instanceId});
assert.equal(match.player.activeCard.instanceId,roster[1].instanceId,"switch support targets the selected duplicate instance");
assert.equal(match.player.supportCards.some(item=>item.instanceId===roster[2].instanceId), false, "only the chosen support instance is consumed");
assert.equal(match.player.supportCards.some(item=>item.instanceId===roster[3].instanceId), true, "other duplicate support copies remain available");
match.status="healChoice"; match.pendingHealChoices=["player","cpu"];
engine.completeHealChoice(match,"player",roster[0].instanceId);
assert.equal(match.healTargetChoices.player,roster[0].instanceId,"healing choice stores the specific injured copy");
assert.equal(match.player.battleCards[1].currentHp,match.player.battleCards[1].maxHp-12,"healing another copy does not alter this one");
const koUnit=match.player.battleCards[1]; match.player.activeBattleCardIndex=koUnit.slotIndex; koUnit.currentHp=0;
engine.recordKO(match.player,match.hooks,1);
const switchAfterKo=engine.moveAfterKO(match.player,roster[0].instanceId);
assert.equal(match.player.activeCard.instanceId,roster[0].instanceId,"KO replacement selects the exact duplicate instance");
assert.equal(switchAfterKo.to,match.player.activeCard.card.name);
match.player.revivalUsed=false;
assert.ok(engine.reviveCard(match.player,roster[1].instanceId,50,match));
assert.equal(match.player.battleCards[1].knockedOut,false,"revival restores the targeted instance");
assert.equal(match.player.battleCards[0].currentHp,1,"reviving another copy leaves its HP unchanged");

const rules = JSON.parse(fs.readFileSync(path.join(__dirname,"..","online-database.rules.json"),"utf8")).rules;
assert.equal(rules[".read"],false); assert.equal(rules[".write"],false);
const roomRules=rules.rooms.$roomId;
assert.equal(roomRules.mode[".validate"],"newData.val() === 'random' || newData.val() === 'free'");
const dealRules=rules.privateRoomData.$roomId.$uid.deal;
assert.ok(dealRules[".write"].includes("auth.uid === $uid") && dealRules[".write"].includes("!data.exists()"));
assert.ok(dealRules[".validate"].includes("=== 'free'") && dealRules[".validate"].includes("=== 'random'"));
assert.ok(dealRules.cards.$index[".validate"].includes("14"),"deal indices are limited to 0..14");
assert.ok(dealRules.cards.$index.instanceId[".validate"].includes("host-free-00") && dealRules.cards.$index.instanceId[".validate"].includes("guest-free-14"));
assert.ok(!JSON.stringify(rules).includes("numChildren"));

const room = schema.createRoomSeed("host-uid", 1, "free");
assert.equal(room.mode,"free");
assert.equal(schema.createRoomSeed("host-uid",1).mode,"random","legacy/default room creation remains random");
console.log("Free online deck tests passed: 56-card catalog, 15-copy rarity extremes, unique instance IDs, Byakko restriction, duplicate-unit state isolation, and scoped rules guards.");
