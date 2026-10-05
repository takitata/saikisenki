/* Pure online battle helpers: commit/reveal, deterministic dice and BattleEngine replay. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OnlineBattleCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const encoder = new TextEncoder();
  const stableAction = (round, role, choice) => JSON.stringify({
    protocol: "saikisenki-rps-v1", round, role,
    hand: choice.hand, seed: choice.seed, nonce: choice.nonce
  });
  const stableSupport = (round, role, choice) => JSON.stringify({
    protocol: "saikisenki-support-v1", round, role,
    supportId: choice.supportId || "", supportDefinitionId: choice.supportDefinitionId || "", nonce: choice.nonce
  });
  async function sha256(value) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function createCommitment(round, role, choice) { return sha256(stableAction(round, role, choice)); }
  async function createSupportCommitment(round, role, choice) { return sha256(stableSupport(round, role, choice)); }
  async function verifyReveal(round, role, choice, expectedHash) {
    if (!choice || !["rock", "scissors", "paper"].includes(choice.hand) || typeof choice.seed !== "string" || typeof choice.nonce !== "string") return false;
    return (await createCommitment(round, role, choice)) === expectedHash;
  }
  async function verifySupportReveal(round, role, choice, expectedHash) {
    if (!choice || typeof choice.supportId !== "string" || typeof choice.supportDefinitionId !== "string" || typeof choice.nonce !== "string") return false;
    if (Boolean(choice.supportId) !== Boolean(choice.supportDefinitionId)) return false;
    return (await createSupportCommitment(round, role, choice)) === expectedHash;
  }
  function randomHex(byteLength = 32) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function dieFrom(material) {
    for (let counter = 0; ; counter++) {
      const hex = await sha256(`${material}|${counter}`);
      const bytes = new Uint8Array(hex.match(/../g).map(part => parseInt(part, 16)));
      const value = new DataView(bytes.buffer).getUint32(0, false);
      const limit = Math.floor(0x100000000 / 6) * 6;
      if (value < limit) return value % 6 + 1;
    }
  }
  async function deriveDice(roomId, round, hostSeed, guestSeed) {
    const shared = await sha256(`saikisenki-dice-v1|${roomId}|${round}|${hostSeed}|${guestSeed}`);
    const values = {};
    for (const role of ["host", "guest"]) {
      values[role] = {
        initial: await dieFrom(`${shared}|${role}|initial`),
        reroll: await dieFrom(`${shared}|${role}|reroll`)
      };
    }
    return values;
  }
  function rngFor(values) {
    const queue = [...values];
    return () => {
      if (!queue.length) throw new Error("Deterministic dice stream exhausted");
      return (queue.shift() - 0.5) / 6;
    };
  }
  function sideSnapshot(side) {
    return {
      activeBattleCardIndex: side.activeBattleCardIndex,
      battleCards: side.battleCards.map(unit => ({
        instanceId: unit.instanceId, cardId: unit.cardId, slotIndex: unit.slotIndex,
        maxHp: unit.maxHp, currentHp: unit.currentHp, knockedOut: unit.knockedOut,
        hasEnteredBattle: unit.hasEnteredBattle, accumulatedDamageBonus: unit.accumulatedDamageBonus,
        oncePerBattleUsed: unit.oncePerBattleUsed, rockUses: unit.rockUses,
        battleStartDamageBonus: unit.battleStartDamageBonus, battleStartHpBonus: unit.battleStartHpBonus
      })),
      usedSupportCards: side.usedSupportCards.map(item => ({ instanceId: item.instanceId, cardId: item.cardId, usedRound: item.usedRound })).sort((a,b) => a.usedRound-b.usedRound || a.instanceId.localeCompare(b.instanceId)),
      supportUsedThisRound: side.supportUsedThisRound, graveyard: side.graveyard.map(item => ({ ...item })),
      revivalUsed: side.revivalUsed, pendingRoundEffects: { ...side.pendingRoundEffects },
      currentRoundEffects: side.currentRoundEffects ? { ...side.currentRoundEffects } : null
    };
  }
  function snapshot(match, localRole = "host") {
    const hostIsPlayer = localRole === "host";
    const hostSide = hostIsPlayer ? match.player : match.cpu;
    const guestSide = hostIsPlayer ? match.cpu : match.player;
    const hostHistory = hostIsPlayer ? match.history.player : match.history.cpu;
    const guestHistory = hostIsPlayer ? match.history.cpu : match.history.player;
    const hostHand = hostIsPlayer ? match.lastResultEntry?.playerHand : match.lastResultEntry?.cpuHand;
    const guestHand = hostIsPlayer ? match.lastResultEntry?.cpuHand : match.lastResultEntry?.playerHand;
    const hostDice = hostIsPlayer ? match.lastResultEntry?.playerDice : match.lastResultEntry?.cpuDice;
    const guestDice = hostIsPlayer ? match.lastResultEntry?.cpuDice : match.lastResultEntry?.playerDice;
    const hostDamage = hostIsPlayer ? match.lastResultEntry?.playerDamage : match.lastResultEntry?.cpuDamage;
    const guestDamage = hostIsPlayer ? match.lastResultEntry?.cpuDamage : match.lastResultEntry?.playerDamage;
    const localRpsResult = match.lastResultEntry?.rpsResult;
    const entry = match.lastResultEntry;
    const hostAttack = hostIsPlayer ? entry?.playerAttack : entry?.cpuAttack;
    const guestAttack = hostIsPlayer ? entry?.cpuAttack : entry?.playerAttack;
    const hostEffects = hostIsPlayer ? entry?.playerEffects : entry?.cpuEffects;
    const guestEffects = hostIsPlayer ? entry?.cpuEffects : entry?.playerEffects;
    const hostHpResult = hostIsPlayer ? entry?.hp?.player : entry?.hp?.cpu;
    const guestHpResult = hostIsPlayer ? entry?.hp?.cpu : entry?.hp?.player;
    const hostKo = hostIsPlayer ? entry?.kos?.player : entry?.kos?.cpu;
    const guestKo = hostIsPlayer ? entry?.kos?.cpu : entry?.kos?.player;
    const hostSwitch = hostIsPlayer ? entry?.switches?.player : entry?.switches?.cpu;
    const guestSwitch = hostIsPlayer ? entry?.switches?.cpu : entry?.switches?.player;
    const damageView = value => value ? { finalDamage: value.finalDamage, opponentDamageReduction: value.opponentDamageReduction, damageReduction: value.damageReduction, shield: value.shield } : null;
    const hpView = value => value ? { before: value.before, healedTo: value.healedTo, incoming: value.incoming, selfDamage: value.selfDamage, after: value.after, knockedOut: value.knockedOut } : null;
    const attackView = value => value ? { cardId: value.card?.id, baseDamage: value.baseDamage, expertBonus: value.expertBonus, supportDamage: value.supportDamage, passiveBonus: value.passiveBonus, rawDamage: value.rawDamage } : null;
    const effectsView = value => value ? { healing: value.healing, shield: value.shield, selfDamage: value.selfDamage, nextEffects: value.nextEffects.map(item => ({...item})), reviveCandidates: [...value.reviveCandidates], reviveHpPercent: value.reviveHpPercent, log: [...value.log] } : null;
    return {
      round: match.round, status: match.status, outcome: hostIsPlayer ? match.outcome : (match.outcome === "WIN" ? "LOSE" : match.outcome === "LOSE" ? "WIN" : match.outcome),
      sides: { host: sideSnapshot(hostSide), guest: sideSnapshot(guestSide) },
      supportLockNextRound: { host: hostIsPlayer ? match.supportLockNextRound.player : match.supportLockNextRound.cpu, guest: hostIsPlayer ? match.supportLockNextRound.cpu : match.supportLockNextRound.player },
      history: { host: JSON.parse(JSON.stringify(hostHistory)), guest: JSON.parse(JSON.stringify(guestHistory)) },
      lastResult: match.lastResultEntry ? {
        round: match.lastResultEntry.round, hostHand, guestHand,
        rpsResult: hostIsPlayer ? localRpsResult : (localRpsResult === "win" ? "loss" : localRpsResult === "loss" ? "win" : "draw"),
        hostDie: hostDice?.finalDie, guestDie: guestDice?.finalDie,
        hostHp: hostSide.activeCard?.currentHp ?? null, guestHp: guestSide.activeCard?.currentHp ?? null,
        hostDamage: hostDamage?.finalDamage, guestDamage: guestDamage?.finalDamage,
        hostDice: hostDice ? { rawDie: hostDice.rawDie, rpsModifier: hostDice.rpsModifier, supportModifier: hostDice.supportModifier, statusModifier: hostDice.statusModifier, unclamped: hostDice.unclamped, finalDie: hostDice.finalDie } : null,
        guestDice: guestDice ? { rawDie: guestDice.rawDie, rpsModifier: guestDice.rpsModifier, supportModifier: guestDice.supportModifier, statusModifier: guestDice.statusModifier, unclamped: guestDice.unclamped, finalDie: guestDice.finalDie } : null,
        hostAttack: attackView(hostAttack), guestAttack: attackView(guestAttack),
        hostDamageDetail: damageView(hostDamage), guestDamageDetail: damageView(guestDamage),
        hostHpChange: hpView(hostHpResult), guestHpChange: hpView(guestHpResult),
        hostEffects: effectsView(hostEffects), guestEffects: effectsView(guestEffects),
        hostKO: hostKo ? { instanceId: hostKo.instanceId, cardId: hostKo.cardId } : null,
        guestKO: guestKo ? { instanceId: guestKo.instanceId, cardId: guestKo.cardId } : null,
        hostSwitch: hostSwitch ? { from: hostSwitch.from, to: hostSwitch.to, slotIndex: hostSwitch.slotIndex } : null,
        guestSwitch: guestSwitch ? { from: guestSwitch.from, to: guestSwitch.to, slotIndex: guestSwitch.slotIndex } : null,
        simultaneousRule: entry.simultaneousRule,
        hostRerolled: hostIsPlayer ? entry.playerRerolled : entry.cpuRerolled,
        guestRerolled: hostIsPlayer ? entry.cpuRerolled : entry.playerRerolled,
        revived: (match.lastResultEntry.revived || []).map(item => ({ instanceId: item.instanceId, hp: item.hp, slotIndex: item.slotIndex })).sort((a,b)=>a.instanceId.localeCompare(b.instanceId))
      } : null
    };
  }
  async function hashSnapshot(value) { return sha256(JSON.stringify(value)); }
  function isSettledRound(round) {
    return Boolean(round?.resultClaims?.host?.hash && round?.resultClaims?.guest?.hash && round.resultClaims.host.hash === round.resultClaims.guest.hash);
  }
  function phaseFor(roundData = {}, role = "host") {
    const other = role === "host" ? "guest" : "host";
    if (!roundData.supportCommits?.[role]) return roundData.supportCommits?.[other] ? "supportSelectAfterOpponent" : "supportSelect";
    if (!roundData.supportCommits?.[other]) return "supportWait";
    if (!roundData.supportReveals?.host || !roundData.supportReveals?.guest) return "supportReveal";
    if (!roundData.actionCommits?.[role]) return "rpsSelect";
    if (!roundData.actionCommits?.[other]) return "rpsWait";
    if (!roundData.actionReveals?.host || !roundData.actionReveals?.guest) return "rpsReveal";
    if (roundData.rerolls?.[role] === undefined || roundData.rerolls?.[other] === undefined) return "reroll";
    if (roundData.resultClaims?.host?.hash && roundData.resultClaims?.guest?.hash && roundData.resultClaims.host.hash !== roundData.resultClaims.guest.hash) return "desync";
    if (!isSettledRound(roundData)) return "resolve";
    if (!roundData.nextReady?.[role] || !roundData.nextReady?.[other]) return "nextRound";
    return "settled";
  }
  function supportPhaseState(roundData = {}, role = "host", supportSealedByEffect = false, selectedSupportId = "", commitPending = false) {
    const other = role === "host" ? "guest" : "host";
    const supportCommitted = Boolean(roundData.supportCommits?.[role]);
    const opponentCommitted = Boolean(roundData.supportCommits?.[other]);
    return {
      supportSelected: Boolean(selectedSupportId),
      supportCommitted,
      waitingForOpponentSupport: supportCommitted && !opponentCommitted,
      supportRevealed: Boolean(roundData.supportReveals?.host && roundData.supportReveals?.guest),
      supportSealedByEffect: Boolean(supportSealedByEffect),
      supportCommitPending: Boolean(commitPending)
    };
  }
  function nextRoundNumber(matchData) {
    let round = 1;
    while (isSettledRound(matchData?.rounds?.[String(round)])) round++;
    return round;
  }
  function makeMatch(engine, { ownOwned, ownBattleIds, opponentBattle, cardMap, localRole = "host" }) {
    const opponentOwned = opponentBattle.map(item => ({ instanceId: item.instanceId, cardId: item.definitionId }));
    const match = engine.createMatch({
      playerOwned: ownOwned.map(item => ({ instanceId: item.instanceId, cardId: item.definitionId || item.cardId })),
      playerOrder: [...ownBattleIds],
      cpuOwned: opponentOwned,
      cpuOrder: opponentOwned.map(item => item.instanceId),
      cardMap
    });
    match.onlineLocalRole = localRole;
    match.player.label = "あなた";
    match.cpu.label = "相手";
    return match;
  }
  function addRevealedSupport(side, owned) {
    if (!side.ownedCards.some(item => item.instanceId === owned.instanceId)) side.ownedCards.push({ ...owned });
    if (!side.supportCards.some(item => item.instanceId === owned.instanceId)) side.supportCards.push({ ...owned });
  }
  function applySupportChoices(engine, match, ownChoice, opponentChoice) {
    if (opponentChoice.supportId) addRevealedSupport(match.cpu, { instanceId: opponentChoice.supportId, cardId: opponentChoice.supportDefinitionId });
    engine.finishPairedSupportPhase(match, ownChoice.supportId || null, opponentChoice.supportId || null);
  }
  function prepareSupportPhase(engine, match, ownSupport, opponentSupport) {
    if (match.status === "supportSelection") applySupportChoices(engine, match, ownSupport, opponentSupport);
    return match;
  }
  function beginRevealedRound(engine, match, ownChoice, opponentChoice, ownDice, opponentDice) {
    if (match.status === "supportSelection") {
      prepareSupportPhase(engine, match, ownChoice.supportChoice || { supportId: "", supportDefinitionId: "" }, opponentChoice.supportChoice || { supportId: "", supportDefinitionId: "" });
    }
    engine.startRpsAndRoll(match, ownChoice.hand, { rng: rngFor([ownDice.initial, opponentDice.initial]), cpuHand: opponentChoice.hand, autoCpuReroll: false });
    return match;
  }
  function resolveRevealedRound(engine, match, ownChoice, opponentChoice, ownReroll, opponentReroll, ownDice, opponentDice, reviveChoices = {}) {
    beginRevealedRound(engine, match, ownChoice, opponentChoice, ownDice, opponentDice);
    return finishRevealedRound(engine, match, ownReroll, opponentReroll, ownDice, opponentDice, reviveChoices);
  }
  function finishRevealedRound(engine, match, ownReroll, opponentReroll, ownDice, opponentDice, reviveChoices = {}) {
    const rerollValues = [];
    if (ownReroll) rerollValues.push(ownDice.reroll);
    if (opponentReroll) rerollValues.push(opponentDice.reroll);
    engine.decideRerolls(match, { player: ownReroll, cpu: opponentReroll }, { rng: rngFor(rerollValues), deferRevives: true });
    if (match.status === "reviveChoice" && match.pendingRevives?.every(request => reviveChoices[request.sideId])) {
      engine.completeOnlineRevives(match, reviveChoices);
    }
    return match;
  }
  return { stableAction, stableSupport, sha256, createCommitment, createSupportCommitment, verifyReveal, verifySupportReveal, randomHex, deriveDice, rngFor, snapshot, hashSnapshot, isSettledRound, phaseFor, supportPhaseState, nextRoundNumber, makeMatch, prepareSupportPhase, beginRevealedRound, finishRevealedRound, resolveRevealedRound };
});
