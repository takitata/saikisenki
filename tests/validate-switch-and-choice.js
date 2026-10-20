/* Regression tests for switch supports, die healing, and post-KO choices. */
const assert = require('node:assert/strict');
global.window = global;
require('../cards.js');
const engine = require('../battle.js');
const cards = new Map(CARD_DATA.map(card => [card.id, card]));
const owned = (definitionId, instanceId) => ({cardId:definitionId,instanceId});
function create(playerBattle, playerSupport, cpuBattle) {
  const playerOwned=[...playerBattle.map((id,i)=>owned(id,`p-b${i}`)),...playerSupport.map((id,i)=>owned(id,`p-s${i}`))];
  const cpuOwned=cpuBattle.map((id,i)=>owned(id,`c-b${i}`));
  return engine.createMatch({playerOwned,playerOrder:playerBattle.map((_,i)=>`p-b${i}`),cpuOwned,cpuOrder:cpuBattle.map((_,i)=>`c-b${i}`),cardMap:cards});
}
function round(match, playerHand='rock', cpuHand='rock', playerDie=6, cpuDie=6, options={}) {
  if(match.status==="supportSelection") engine.finishSupportPhase(match,null,{skipCpuSupport:true});
  engine.startRpsAndRoll(match,playerHand,{cpuHand,rng:()=>((Math.max(1,Math.min(6,playerDie))-.5)/6),autoCpuReroll:false});
  match.pendingRound.cpuData.rawDie=cpuDie;
  match.pendingRound.playerData.rawDie=playerDie;
  return engine.decideRerolls(match,{player:false,cpu:false},options);
}
for(const id of ['n-green-treant','n-white-summoner','n-red-knight','n-blue-amoeba']) {
  assert.equal(cards.get(id).support.length,1,`${id} has one support effect`);
  assert.equal(cards.get(id).support[0].kind,'switchBattleCard',`${id} support is switch`);
}
{
  const m=create(['n-green-treant','n-green-warrior'],['n-red-knight'],['n-blue-warrior']);
  m.player.battleCards[1].currentHp=37;
  engine.finishSupportPhase(m,'p-s0',{skipCpuSupport:true,playerSwitchTargetId:'p-b1'});
  assert.equal(m.player.activeCard.instanceId,'p-b1','switch support makes selected reserve active');
  assert.equal(m.player.activeCard.currentHp,37,'switch preserves reserve HP');
  assert.equal(m.player.supportUsedThisRound,true,'switch consumes one support');
  assert.equal(m.player.supportCards.length,0,'used switch support is consumed');
  assert.equal(m.player.activeCard.card.attribute,'green','post-switch active attribute is current');
  m.cpu.battleCards[0].maxHp=1000;m.cpu.battleCards[0].currentHp=1000;
  round(m,'scissors','paper',2,2);
  assert.equal(m.lastResultEntry.playerAttack.card.id,'n-green-warrior','switched card acts in the same round');
  assert.equal(m.lastResultEntry.playerAttack.expertBonus,15,'same-round attribute bonus uses the switched-in green card');
}
{
  const m=create(['n-green-treant'],['n-red-knight'],['n-blue-warrior']);
  assert.throws(()=>engine.applySupport(m,'player','p-s0',{switchTargetId:'missing'}),/控え/);
  assert.equal(m.player.supportCards.length,1,'unavailable switch does not consume support');
}
{
  const m=create(['n-red-vampire','n-green-warrior'],[],['n-white-monk']);
  m.player.battleCards[0].currentHp=70;
  m.player.battleCards[1].currentHp=30;
  m.cpu.battleCards[0].maxHp=1000;m.cpu.battleCards[0].currentHp=1000;
  round(m,'rock','rock',6,1);
  assert.equal(m.status,'healChoice','die healing pauses for player target');
  assert.deepEqual(m.pendingHealChoices,['player']);
  engine.completeHealChoice(m,'player','p-b1');
  assert.equal(m.player.battleCards[1].currentHp,45,'die heal applies to chosen living reserve');
  assert.equal(m.player.battleCards[0].currentHp,60,'active card receives damage after reserve healing');
  assert.equal(m.status,'roundResolved','round resumes after target chosen');
}
{
  const m=create(['n-red-knight','n-green-treant'],[],['n-white-monk']);
  m.player.battleCards[0].currentHp=1;
  m.cpu.battleCards[0].maxHp=1000;m.cpu.battleCards[0].currentHp=1000;
  round(m,'rock','paper',6,6);
  assert.equal(m.status,'nextCardChoice','player chooses after active KO');
  engine.completeNextCardChoice(m,'player','p-b1');
  assert.equal(m.player.activeCard.instanceId,'p-b1','selected reserve enters after KO');
  assert.equal(m.status,'roundResolved','round resolves after choice');
}
{
  const m=create(['n-red-knight','n-green-treant'],[],['n-blue-warrior','n-white-monk']);
  m.player.battleCards[0].currentHp=1;m.cpu.battleCards[0].currentHp=1;
  round(m,'rock','rock',6,6,{deferNextCardChoices:true});
  assert.equal(m.status,'nextCardChoice','paired online KO waits for both next-card choices');
  assert.deepEqual(m.pendingNextCardChoices,['player','cpu']);
  engine.completeOnlineNextCardChoices(m,{player:'p-b1',cpu:'c-b1'});
  assert.equal(m.player.activeCard.instanceId,'p-b1');
  assert.equal(m.cpu.activeCard.instanceId,'c-b1');
  assert.equal(m.status,'roundResolved');
}
{
  const m=create(['n-blue-warrior','l-blue-seiryu'],[],['n-red-knight']);
  m.cpu.battleCards[0].maxHp=500;m.cpu.battleCards[0].currentHp=500;
  for(let i=0;i<3;i++) { if(m.status==='roundResolved')engine.advanceRound(m); round(m,'paper','rock',1,1); }
  assert.equal(m.player.battleCards[1].awakened,true,'reserve Seiryu awakens from team-wide paper wins');
  assert.equal(m.player.battleCards[1].maxHp,170);
}
{
  const m=create(['n-blue-warrior','l-red-suzaku'],['n-green-treant'],['n-red-knight']);
  const fallen=m.player.battleCards[0];fallen.currentHp=0;fallen.knockedOut=true;m.player.graveyard.push({instanceId:fallen.instanceId,cardId:fallen.cardId,name:fallen.card.name,slotIndex:fallen.slotIndex});
  m.player.activeBattleCardIndex=1;
  engine.reviveCard(m.player,fallen.instanceId,50,m);
  assert.equal(fallen.currentHp,Math.floor(fallen.maxHp*0.5),'revival retains the 50% rule');
  assert.equal(m.player.activeCard.instanceId,'p-b1','revival returns to reserve without immediate active swap');
  engine.applySupport(m,'player','p-s0',{switchTargetId:fallen.instanceId});
  assert.equal(m.player.activeCard.instanceId,fallen.instanceId,'revived reserve can be selected by a later switch');
}
{
  const m=create(['n-red-vampire','n-green-warrior'],[],['n-white-monk']);
  m.player.battleCards[1].currentHp=m.player.battleCards[1].maxHp-5;
  m.cpu.activeCard.maxHp=1000;m.cpu.activeCard.currentHp=1000;
  round(m,'rock','rock',6,1);
  engine.completeHealChoice(m,'player','p-b1');
  assert.equal(m.player.battleCards[1].currentHp,m.player.battleCards[1].maxHp,'selected die-heal target is capped at max HP');
  assert.throws(()=>engine.completeHealChoice(m,'player','c-b0'),/pending/,'dead or foreign target cannot be selected');
}
console.log('switch/heal/KO choice tests: PASS');




