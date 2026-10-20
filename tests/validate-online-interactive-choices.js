const assert=require('node:assert/strict');
const fs=require('node:fs');
global.window=global;
require('../cards.js');
require('../online-battle-core.js');
const Engine=require('../battle.js');
const Core=require('../online-battle-core.js');
const cards=new Map(CARD_DATA.map(card=>[card.id,card]));
const cardMap=new Map(cards);
cardMap.set('n-white-monk',{...cards.get('n-white-monk'),dice:[0,0,0,0,0,0]});
const activeA={instanceId:'a-vampire',definitionId:'n-red-vampire'};
const reserveA={instanceId:'a-reserve',definitionId:'n-green-warrior'};
const enemy={instanceId:'b-enemy',definitionId:'n-white-monk'};
const host=Core.makeMatch(Engine,{ownOwned:[activeA,reserveA],ownBattleIds:[activeA.instanceId,reserveA.instanceId],opponentBattle:[enemy],cardMap,localRole:'host'});
const guest=Core.makeMatch(Engine,{ownOwned:[enemy],ownBattleIds:[enemy.instanceId],opponentBattle:[activeA,reserveA],cardMap,localRole:'guest'});
for(const match of [host,guest]) {
  for(const side of [match.player,match.cpu]) for(const unit of side.battleCards){if(unit.instanceId==='a-vampire')unit.currentHp=70;if(unit.instanceId==='a-reserve')unit.currentHp=30;if(unit.instanceId==='b-enemy')unit.currentHp=unit.maxHp;}
}
const none={supportId:'',supportDefinitionId:'',nonce:'x'};
const hostResult=Core.resolveRevealedRound(Engine,host,{hand:'rock',supportChoice:none},{hand:'rock',supportChoice:none},false,false,{initial:6,reroll:2},{initial:1,reroll:3},{},{player:'a-reserve'},{ });
const guestResult=Core.resolveRevealedRound(Engine,guest,{hand:'rock',supportChoice:none},{hand:'rock',supportChoice:none},false,false,{initial:1,reroll:3},{initial:6,reroll:2},{},{cpu:'a-reserve'},{ });
assert.equal(hostResult.status,'roundResolved');
assert.equal(guestResult.status,'roundResolved');
assert.equal(host.player.battleCards.find(unit=>unit.instanceId==='a-reserve').currentHp,45);
assert.equal(host.player.battleCards.find(unit=>unit.instanceId==='a-vampire').currentHp,70,'reserve heal is not also added to active HP');
assert.deepEqual(Core.snapshot(host,'host'),Core.snapshot(guest,'guest'),'chosen healing target and resulting HP match both role perspectives');

const autoHost=Core.makeMatch(Engine,{ownOwned:[activeA,reserveA],ownBattleIds:[activeA.instanceId,reserveA.instanceId],opponentBattle:[enemy],cardMap,localRole:'host'});
const autoGuest=Core.makeMatch(Engine,{ownOwned:[enemy],ownBattleIds:[enemy.instanceId],opponentBattle:[activeA,reserveA],cardMap,localRole:'guest'});
for(const match of [autoHost,autoGuest]) for(const side of [match.player,match.cpu]) for(const unit of side.battleCards){unit.currentHp=unit.maxHp;}
const hostAuto=Core.resolveRevealedRound(Engine,autoHost,{hand:'rock',supportChoice:none},{hand:'rock',supportChoice:none},false,false,{initial:6,reroll:2},{initial:1,reroll:3},{},{},{});
const guestAuto=Core.resolveRevealedRound(Engine,autoGuest,{hand:'rock',supportChoice:none},{hand:'rock',supportChoice:none},false,false,{initial:1,reroll:3},{initial:6,reroll:2},{},{},{});
assert.equal(hostAuto.status,'roundResolved');assert.equal(guestAuto.status,'roundResolved');
assert.equal(autoHost.status,'roundResolved','online automatic heal target must not leave a waiting state');
assert.equal(autoHost.lastResultEntry.hp.player.healTargetAfter,autoHost.lastResultEntry.hp.player.healTargetBefore,'all-full online heal selects the active card and heals zero');
assert.ok(!autoHost.pendingHealChoices?.length&&!autoGuest.pendingHealChoices?.length,'automatic target leaves no pending heal choice');
assert.deepEqual(Core.snapshot(autoHost,'host'),Core.snapshot(autoGuest,'guest'),'automatic heal target produces matching host/guest state');

const injuredHost=Core.makeMatch(Engine,{ownOwned:[activeA,reserveA],ownBattleIds:[activeA.instanceId,reserveA.instanceId],opponentBattle:[enemy],cardMap,localRole:'host'});
const injuredGuest=Core.makeMatch(Engine,{ownOwned:[enemy],ownBattleIds:[enemy.instanceId],opponentBattle:[activeA,reserveA],cardMap,localRole:'guest'});
for(const match of [injuredHost,injuredGuest]) for(const side of [match.player,match.cpu]) for(const unit of side.battleCards){unit.currentHp=unit.maxHp;if(unit.instanceId==='a-vampire')unit.currentHp=70;}
const hostInjuredAuto=Core.resolveRevealedRound(Engine,injuredHost,{hand:'rock',supportChoice:none},{hand:'rock',supportChoice:none},false,false,{initial:6,reroll:2},{initial:1,reroll:3},{},{},{});
const guestInjuredAuto=Core.resolveRevealedRound(Engine,injuredGuest,{hand:'rock',supportChoice:none},{hand:'rock',supportChoice:none},false,false,{initial:1,reroll:3},{initial:6,reroll:2},{},{},{});
assert.equal(hostInjuredAuto.status,'roundResolved');assert.equal(guestInjuredAuto.status,'roundResolved');
assert.equal(injuredHost.lastResultEntry.hp.player.healTargetAfter,85,'injured active card auto-heals exactly once when every living reserve is full');
assert.deepEqual(Core.snapshot(injuredHost,'host'),Core.snapshot(injuredGuest,'guest'),'automatic active heal remains mirrored across roles');

const pA={instanceId:'p-active',definitionId:'n-red-knight'};
const pB={instanceId:'p-next',definitionId:'n-green-warrior'};
const cA={instanceId:'c-active',definitionId:'n-red-knight'};
const cB={instanceId:'c-next',definitionId:'n-green-warrior'};
const koHost=Core.makeMatch(Engine,{ownOwned:[pA,pB],ownBattleIds:[pA.instanceId,pB.instanceId],opponentBattle:[cA,cB],cardMap,localRole:'host'});
const koGuest=Core.makeMatch(Engine,{ownOwned:[cA,cB],ownBattleIds:[cA.instanceId,cB.instanceId],opponentBattle:[pA,pB],cardMap,localRole:'guest'});
for(const match of [koHost,koGuest]) for(const side of [match.player,match.cpu]) { side.battleCards[0].currentHp=1; side.battleCards[0].card={...side.battleCards[0].card,dice:[100,100,100,100,100,100]}; }
const hostKO=Core.resolveRevealedRound(Engine,koHost,{hand:'rock',supportChoice:none},{hand:'rock',supportChoice:none},false,false,{initial:6,reroll:2},{initial:6,reroll:3},{},{},{player:'p-next',cpu:'c-next'});
const guestKO=Core.resolveRevealedRound(Engine,koGuest,{hand:'rock',supportChoice:none},{hand:'rock',supportChoice:none},false,false,{initial:6,reroll:3},{initial:6,reroll:2},{},{},{player:'c-next',cpu:'p-next'});
assert.equal(hostKO.status,'roundResolved');assert.equal(guestKO.status,'roundResolved');
assert.equal(koHost.player.activeCard.instanceId,'p-next');assert.equal(koHost.cpu.activeCard.instanceId,'c-next');
assert.deepEqual(Core.snapshot(koHost,'host'),Core.snapshot(koGuest,'guest'),'paired KO selections produce identical online snapshots');
const gameSource=fs.readFileSync(require.resolve('../game.js'),'utf8');
assert.match(gameSource,/engine\.livingCards\(side\)\.filter\(unit => unit !== active\)/,'battle-card display counts living reserves while active selection is pending');
assert.match(gameSource,/次のカードを選択中/,'KO choice view has a pending-selection label instead of a false all-KO label');
assert.match(gameSource,/生存しているバトルカード：\$\{remaining\.length\}枚/,'pending-selection view shows the survivor count');
console.log('online interactive healing and KO choice replay: PASS');
