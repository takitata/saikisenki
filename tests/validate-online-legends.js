const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
global.crypto = require('node:crypto').webcrypto;
global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'..','cards.js'),'utf8'),{filename:'cards.js'});
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'..','online-schema.js'),'utf8'),{filename:'online-schema.js'});
const cards=window.CARD_DATA, cardMap=new Map(cards.map(card=>[card.id,card]));
const Engine=require('../battle.js');
const Core=require('../online-battle-core.js');
for(const id of ['l-red-suzaku','l-blue-seiryu','l-green-genbu','l-white-byakko']) assert.ok(cardMap.has(id));
const roster=(prefix,definitionId)=>[{instanceId:`${prefix}-1`,definitionId}];
const hostMatch=Core.makeMatch(Engine,{ownOwned:roster('host','l-blue-seiryu'),ownBattleIds:['host-1'],opponentBattle:roster('guest','n-white-warrior'),cardMap,localRole:'host'});
const guestMatch=Core.makeMatch(Engine,{ownOwned:roster('guest','n-white-warrior'),ownBattleIds:['guest-1'],opponentBattle:roster('host','l-blue-seiryu'),cardMap,localRole:'guest'});
const none={supportId:'',supportDefinitionId:'',reviveTargetId:'',nonce:'n'};
for(let round=1;round<=3;round++){
  Core.resolveRevealedRound(Engine,hostMatch,{hand:'paper',supportChoice:none},{hand:'rock',supportChoice:none},false,false,{initial:1,reroll:2},{initial:1,reroll:3});
  Core.resolveRevealedRound(Engine,guestMatch,{hand:'rock',supportChoice:none},{hand:'paper',supportChoice:none},false,false,{initial:1,reroll:3},{initial:1,reroll:2});
  assert.deepEqual(Core.snapshot(hostMatch,'host'),Core.snapshot(guestMatch,'guest'),`host/guest deterministic snapshots at round ${round}`);
  if(round<3){Engine.advanceRound(hostMatch);Engine.advanceRound(guestMatch);}
}
assert.equal(hostMatch.player.activeCard.awakened,true);
assert.equal(hostMatch.player.activeCard.maxHp,170);
assert.equal(Core.snapshot(hostMatch,'host').battleCounters.host.paperWins,3);
const legendDeal={cards:[{instanceId:'byakko-1',definitionId:'l-white-byakko'},{instanceId:'normal-1',definitionId:'n-white-warrior'}]};
assert.equal(window.OnlineRoomSchema.createOnlineFormation(['byakko-1','normal-1'],legendDeal),null,'online formation rejects White Tiger combined with another battle card');
assert.ok(window.OnlineRoomSchema.createOnlineFormation(['byakko-1'],legendDeal),'online formation accepts White Tiger as the only battle card');

// A revealed Suzaku support choice revives a selected friendly grave card in both local views.
const hostOwned=[{instanceId:'h-active',definitionId:'n-white-warrior'},{instanceId:'h-target',definitionId:'n-green-warrior'},{instanceId:'h-suzaku',definitionId:'l-red-suzaku'}];
const guestOwned=[{instanceId:'g-active',definitionId:'n-white-warrior'}];
const hostBattle=[{instanceId:'h-active',definitionId:'n-white-warrior'},{instanceId:'h-target',definitionId:'n-green-warrior'}];
const pairedHost=Core.makeMatch(Engine,{ownOwned:hostOwned,ownBattleIds:['h-active','h-target'],opponentBattle:guestOwned,cardMap,localRole:'host'});
const pairedGuest=Core.makeMatch(Engine,{ownOwned:guestOwned,ownBattleIds:['g-active'],opponentBattle:hostBattle,cardMap,localRole:'guest'});
for(const side of [pairedHost.player,pairedGuest.cpu]){const target=side.battleCards.find(unit=>unit.instanceId==='h-target');target.knockedOut=true;target.currentHp=0;side.graveyard.push({instanceId:target.instanceId,cardId:target.cardId,name:target.card.name,slotIndex:target.slotIndex});}
const suzakuChoice={supportId:'h-suzaku',supportDefinitionId:'l-red-suzaku',reviveTargetId:'h-target',nonce:'s'};
Core.resolveRevealedRound(Engine,pairedHost,{hand:'rock',supportChoice:suzakuChoice},{hand:'rock',supportChoice:none},false,false,{initial:1,reroll:2},{initial:1,reroll:3});
Core.resolveRevealedRound(Engine,pairedGuest,{hand:'rock',supportChoice:none},{hand:'rock',supportChoice:suzakuChoice},false,false,{initial:1,reroll:3},{initial:1,reroll:2});
assert.deepEqual(Core.snapshot(pairedHost,'host'),Core.snapshot(pairedGuest,'guest'));
assert.equal(pairedHost.player.battleCards[1].currentHp,pairedHost.player.battleCards[1].maxHp);
assert.equal(pairedHost.player.revivalUsed,true);assert.equal(pairedGuest.cpu.revivalUsed,true);
const reveal={supportId:'s-1',supportDefinitionId:'l-red-suzaku',reviveTargetId:'grave-1',nonce:'0'.repeat(64)};
(async()=>{
  const commitment=await Core.createSupportCommitment(1,'host',reveal);
  assert.equal(await Core.verifySupportReveal(1,'host',reveal,commitment),true,'Legend support and selected revive target verify under commit/reveal');
  const altered={...reveal,reviveTargetId:'grave-2'};
  assert.equal(await Core.verifySupportReveal(1,'host',altered,commitment),false,'revive target is bound to commitment');
  console.log('OK: online Legend deterministic replay, host/guest mirrored snapshots, awakening counters, and sealed support-target verification.');
})().catch(error=>{console.error(error);process.exitCode=1;});
