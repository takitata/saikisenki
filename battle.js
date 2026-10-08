/* Structured Normal effects, support phase, simultaneous combat, and extensible hooks. */
(() => {
  const HANDS = ["rock", "scissors", "paper"];
  const HAND_LABELS = { rock: "グー", scissors: "チョキ", paper: "パー" };
  const ATTRIBUTE_HAND = { red: "rock", blue: "paper", green: "scissors", white: null };
  const HAND_BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };
  const ATTRIBUTE_LABEL = { red:"赤", blue:"青", green:"緑", white:"白" };
  const MAX_BATTLE_CARDS = 5;
  const HOOK_NAMES = ["beforeRound","beforeRps","afterRps","beforeDice","afterRawDice","afterFinalDice","beforeDamage","afterDamage","onKO","afterRound"];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function determineRps(playerHand, cpuHand) {
    if (!HANDS.includes(playerHand) || !HANDS.includes(cpuHand)) throw new Error("Invalid RPS hand");
    return playerHand === cpuHand ? "draw" : HAND_BEATS[playerHand] === cpuHand ? "win" : "loss";
  }
  function rollD6(rng = Math.random) { return Math.floor(rng() * 6) + 1; }
  function getRpsDieModifier(result) { return result === "win" ? 1 : result === "loss" ? -2 : 0; }
  function clampFinalDie(value) { return clamp(value, 1, 6); }
  function getBasicDamage(card, finalDie) { return card.dice[finalDie - 1]; }
  function getExpertHandBonus(card, hand, rpsResult) {
    if (rpsResult !== "win") return 0;
    if (card.attribute === "white") return 10;
    return ATTRIBUTE_HAND[card.attribute] === hand ? 15 : 0;
  }
  function createHookSet() { return Object.fromEntries(HOOK_NAMES.map(name => [name, []])); }
  function runHooks(hooks, timing, context) { for (const hook of hooks?.[timing] || []) hook(context); }

  function createSide({ id, label, ownedCards, battleOrder, cardMap }) {
    const battleSet = new Set(battleOrder);
    const battleCards = battleOrder.map((instanceId, slotIndex) => {
      const owned = ownedCards.find(item => item.instanceId === instanceId);
      if (!owned) throw new Error(`Unknown card instance: ${instanceId}`);
      const card = cardMap.get(owned.cardId);
      if (!card) throw new Error(`Unknown card definition: ${owned.cardId}`);
      return { instanceId: owned.instanceId, cardId: owned.cardId, card, slotIndex, maxHp: card.baseHp, currentHp: card.baseHp, knockedOut: false, hasEnteredBattle: false, accumulatedDamageBonus: 0, oncePerBattleUsed: false, rockUses: 0, battleStartDamageBonus: 0, battleStartHpBonus: 0 };
    });
    if (battleCards.length < 1 || battleCards.length > MAX_BATTLE_CARDS) throw new Error("Battle team must contain 1 to 5 cards");
    const side = {
      id, label, cardMap, ownedCards: ownedCards.map(item => ({ ...item })), battleCards,
      supportCards: ownedCards.filter(item => !battleSet.has(item.instanceId)).map(item => ({ ...item })),
      usedSupportCards: [], supportUsedThisRound: false, activeBattleCardIndex: 0, graveyard: [], revivalUsed: false, pendingRoundEffects: { dieModifier: 0, incomingDamageReduction: 0, outgoingDamageReduction: 0, rawDieOverride: null },
      currentRoundEffects: null,
      get activeCard() { return this.battleCards[this.activeBattleCardIndex] || null; }
    };
    side.battleCards[0].hasEnteredBattle = true;
    return side;
  }
  function freshRoundEffects(side) {
    const effects = {
      supportDieModifier: 0, statusDieModifier: side.pendingRoundEffects.dieModifier,
      statusRawDieOverride: side.pendingRoundEffects.rawDieOverride, supportRawDieOverride: null, deferredSupportEffects: [],
      damageBonus: 0, incomingDamageReduction: side.pendingRoundEffects.incomingDamageReduction,
      outgoingDamageReduction: side.pendingRoundEffects.outgoingDamageReduction, suppressRpsDieModifier: false,
      shield: 0, selfDamage: 0, rerollAvailable: false
    };
    side.pendingRoundEffects = { dieModifier: 0, incomingDamageReduction: 0, outgoingDamageReduction: 0, rawDieOverride: null };
    side.supportUsedThisRound = false;
    side.currentRoundEffects = effects;
  }
  function initializeRareBattleState(match, side) {
    const count = side.battleCards.length;
    for (const unit of side.battleCards) {
      const hpPassive = unit.card.passives.find(item => item.kind === "maxHpBonusPerOtherBattleCard");
      if (hpPassive) {
        const attribute = hpPassive.condition?.attribute;
        const eligible = side.battleCards.filter(other => other !== unit && (!attribute || other.card.attribute === attribute)).length;
        unit.battleStartHpBonus = eligible * hpPassive.value;
        unit.maxHp += unit.battleStartHpBonus; unit.currentHp = unit.maxHp;
      }
      const formationPassive = unit.card.passives.find(item => item.kind === "formationScaling");
      const scale = formationPassive?.value?.[count];
      if (scale) {
        unit.maxHp = scale.hp; unit.currentHp = scale.hp; unit.battleStartDamageBonus = scale.damageBonus;
      }
    }
    match.battleState.counters[side.id].startingBattleCardCount = count;
  }
  function createMatch({ playerOwned, playerOrder, cpuOwned, cpuOrder, cardMap, hooks = createHookSet() }) {
    const match = {
      player: createSide({ id: "player", label: "プレイヤー", ownedCards: playerOwned, battleOrder: playerOrder, cardMap }),
      cpu: createSide({ id: "cpu", label: "CPU", ownedCards: cpuOwned, battleOrder: cpuOrder, cardMap }),
      round: 1, outcome: null, status: "supportSelection", log: [], hooks, cardMap,
      pendingRound: null, pendingRevive: null, supportLockNextRound: { player:false, cpu:false },
      battleState: { counters: { player:{}, cpu:{} } },
      history: {
        player: { handWins:{rock:0,scissors:0,paper:0}, handLosses:{rock:0,scissors:0,paper:0}, rpsWins:0, rpsLosses:0, cardKOs:0, supportUses:0 },
        cpu: { handWins:{rock:0,scissors:0,paper:0}, handLosses:{rock:0,scissors:0,paper:0}, rpsWins:0, rpsLosses:0, cardKOs:0, supportUses:0 }
      }
    };
    freshRoundEffects(match.player); freshRoundEffects(match.cpu);
    for (const side of [match.player, match.cpu]) initializeRareBattleState(match, side);
    match.log.push({ round: 1, type: "roundStart", lines: ["ROUND 1：ラウンド開始"] });
    runHooks(hooks, "beforeRound", { match, round: 1 });
    return match;
  }

  function conditionMet(condition, side) {
    if (!condition) return false;
    const hpThreshold = typeof condition === "string" && condition.match(/^currentHpAtMost:(\d+(?:\.\d+)?)%$/);
    if (hpThreshold) return !!side.activeCard && side.activeCard.currentHp <= side.activeCard.maxHp * Number(hpThreshold[1]) / 100;
    if (condition.startsWith?.("currentBattleAttribute:")) return side.activeCard?.card.attribute === condition.split(":")[1];
    return false;
  }
  function passiveConditionMet(passive, side, hand, rpsResult) {
    const condition = passive.condition;
    if (!condition) return true;
    if (typeof condition === "object" && condition.condition === "rockPaperScissorsWin") {
      return rpsResult === "win" && (!condition.hand || condition.hand === hand);
    }
    return typeof condition === "string" && conditionMet(condition, side);
  }
  function findPassive(card, kind) { return card.passives.find(item => item.kind === kind); }
  function effectValue(effect, side) {
    if (effect.conditional && conditionMet(effect.conditional.condition, side)) return effect.conditional.value;
    if (effect.condition && ["damageBonus","heal","damageReduction","dieModifier","opponentDieModifier","opponentDamageReduction"].includes(effect.kind)) return conditionMet(effect.condition, side) ? effect.value : null;
    return effect.value;
  }
  function findOwnedCard(side, instanceId) { return side.ownedCards.find(card => card.instanceId === instanceId); }
  function effectSummary(effect, amount = effect.value) {
    const sign = amount >= 0 ? `+${amount}` : String(amount);
    switch (effect.kind) {
      case "damageBonus": return `ダメージ${sign}`;
      case "damageReduction": return `受けるダメージ-${amount}`;
      case "heal": return `${amount}回復`;
      case "selfDamage": return `自分に${amount}ダメージ`;
      case "dieModifier": return `自分のダイス${sign}`;
      case "opponentDieModifier": return `相手のダイス${sign}`;
      case "reroll": return "振り直し権";
      case "nextOpponentDamageReduction": return `相手の次のダメージ-${amount}`;
      case "opponentDamageReduction": return `相手のダメージ-${amount}`;
      case "suppressRpsDieModifier": return "両者のじゃんけん由来ダイス補正を無効化";
      case "rawDieOverride": return `補正前ダイスを${amount}にする`;
      case "nextRoundRawDieOverride": return `次ラウンドの補正前ダイスを${amount}にする`;
      case "damageBonusPerRpsLoss": return `じゃんけん敗北ごとにダメージ+${amount}`;
      default: return effect.kind;
    }
  }
  function applySupportEffect(match, side, effect, sourceName) {
    const own = side.currentRoundEffects;
    const opponent = (side.id === "player" ? match.cpu : match.player).currentRoundEffects;
    if (effect.condition && typeof effect.condition === "object" && ["handIs", "rpsResult", "finalDieParity"].includes(effect.condition.kind)) {
      own.deferredSupportEffects.push({ kind:effect.kind, value:effect.value, condition:{...effect.condition}, source:sourceName });
      return { kind:effect.kind, value:effect.value, source:sourceName, actual:effect.value, target:side.id, deferred:true };
    }
    const value = effectValue(effect, side);
    const condition = effect.conditional?.condition || effect.condition;
    const conditionApplied = !!condition && conditionMet(condition,side);
    const hpCondition = typeof condition === "string" && condition.match(/^currentHpAtMost:(\d+(?:\.\d+)?)%$/);
    const conditionNote = conditionApplied ? hpCondition ? `現在HPが${hpCondition[1]}%以下` : condition.startsWith?.("currentBattleAttribute:") ? `現在のアクティブが${ATTRIBUTE_LABEL[condition.split(":")[1]]}属性` : "条件成立" : "";
    const result = { kind: effect.kind, value, source: sourceName, actual: value, target: side.id, conditionNote };
    if(value===null){result.actual=0;result.inactive=true;return result;}
    switch (effect.kind) {
      case "damageBonus": own.damageBonus += value; break;
      case "rawDieOverride": own.supportRawDieOverride = value; break;
      case "damageReduction": own.incomingDamageReduction += value; break;
      case "heal": {
        const active = side.activeCard;
        result.actual = active ? Math.min(value, active.maxHp - active.currentHp) : 0;
        if (active) active.currentHp += result.actual;
        result.afterHp = active?.currentHp ?? 0;
        break;
      }
      case "selfDamage": own.selfDamage += value; break;
      case "dieModifier": result.actual = effect.attributeBonus && side.activeCard?.card.attribute === effect.attribute ? effect.attributeBonus : value; result.value = result.actual; own.supportDieModifier += result.actual; break;
      case "opponentDieModifier": opponent.supportDieModifier += value; result.target = side.id === "player" ? "cpu" : "player"; break;
      case "opponentDamageReduction":
      case "nextOpponentDamageReduction": opponent.outgoingDamageReduction += value; result.target = side.id === "player" ? "cpu" : "player"; break;
      case "reroll": own.rerollAvailable = true; break;
      case "suppressRpsDieModifier": own.suppressRpsDieModifier = true; opponent.suppressRpsDieModifier = true; break;
      default: result.ignored = true;
    }
    return result;
  }
  function applySupport(match, sideId, instanceId) {
    if (match.status !== "supportSelection") throw new Error("Support selection is closed");
    if (match.supportLockNextRound[sideId]) throw new Error("Support cards are sealed for this round");
    const side = match[sideId];
    if(side.supportUsedThisRound) throw new Error("Only one support card may be used each round");
    const owned = findOwnedCard(side, instanceId);
    if (!owned || !side.supportCards.some(card => card.instanceId === instanceId)) throw new Error("Support card is not available");
    const card = side.supportCards.find(item => item.instanceId === instanceId);
    const definition = side.cardMap?.get?.(card.cardId) || match.cardMap.get(card.cardId);
    if (!definition) throw new Error("Unknown support card");
    side.supportCards = side.supportCards.filter(item => item.instanceId !== instanceId);
    side.supportUsedThisRound = true;
    side.usedSupportCards.push({ ...card, usedRound: match.round });
    match.history[sideId].supportUses++;
    const effects = definition.support.map(effect => applySupportEffect(match, side, effect, definition.name));
    const event = { type: "support", side: sideId, card: definition.name, instanceId, effects };
    match.log.push({ round: match.round, type: "support", event, lines: supportLog(event) });
    return event;
  }
  function supportLog(event) {
    return event.effects.map(item => {
      if(item.inactive) return `${event.side === "cpu" ? "CPU" : "プレイヤー"}：${event.card}サポート使用 → 条件を満たさず効果なし`;
      const reason=item.conditionNote?`（${item.conditionNote}）`:"";
      if (item.kind === "heal") return item.actual ? `${event.side === "cpu" ? "CPU" : "プレイヤー"}：${event.card}サポート使用 → ${item.actual}回復（HP${item.afterHp}）${reason}` : `${event.side === "cpu" ? "CPU" : "プレイヤー"}：${event.card}サポート使用 → HP満タンのため回復なし`;
      if (item.kind === "opponentDieModifier") return `${event.side === "cpu" ? "CPU" : "プレイヤー"}：${event.card}サポート使用 → ${item.target === "cpu" ? "CPU" : "プレイヤー"}のこのラウンドのダイス${item.value >= 0 ? "+" : ""}${item.value}${reason}`;
      if (item.kind.includes("DamageReduction")) return `${event.side === "cpu" ? "CPU" : "プレイヤー"}：${event.card}サポート使用 → ${item.target === "cpu" ? "CPU" : "プレイヤー"}のこのラウンドのダメージを${item.value}軽減${reason}`;
      return `${event.side === "cpu" ? "CPU" : "プレイヤー"}：${event.card}サポート使用 → ${effectSummary(item)}${reason}${item.ignored ? "（未対応）" : ""}`;
    });
  }
  function supportScore(definition, side) {
    let score = 0;
    for (const effect of definition.support) {
      const value = effectValue(effect, side);
      if(value===null) continue;
      if (effect.kind === "heal") {
        const missing = side.activeCard ? side.activeCard.maxHp - side.activeCard.currentHp : 0;
        if (missing >= Math.max(8, value * 0.6)) score += Math.min(3, missing / 25);
      } else if (["damageBonus","damageReduction","opponentDieModifier","dieModifier","rawDieOverride","opponentDamageReduction","nextOpponentDamageReduction","suppressRpsDieModifier"].includes(effect.kind)) score += 1.6;
      else if (effect.kind === "reroll") score += side.activeCard?.card.id === "n-white-clown" ? 0.7 : 1.2;
    }
    return score;
  }
  function chooseCpuSupport(match, rng = Math.random, overrideInstanceId = null) {
    const cpu = match.cpu;
    const candidates = cpu.supportCards.map(owned => ({ owned, definition: match.cardMap.get(owned.cardId) }))
      .filter(item => item.definition)
      .map(item => ({ ...item, score: supportScore(item.definition, cpu) }))
      .filter(item => item.score > 0);
    if (overrideInstanceId) return applySupport(match, "cpu", overrideInstanceId);
    if (!candidates.length || rng() > 0.68) return null;
    candidates.sort((a,b) => b.score - a.score);
    const top = candidates.filter(item => item.score === candidates[0].score);
    const picked = top[Math.floor(rng() * top.length)];
    return applySupport(match, "cpu", picked.owned.instanceId);
  }
  function finishSupportPhase(match, playerSupportId = null, { rng = Math.random, cpuSupportId = null, skipCpuSupport = false } = {}) {
    if (match.status !== "supportSelection") throw new Error("Not in support phase");
    if (match.supportLockNextRound.player) match.log.push({round:match.round,type:"support",lines:["封印術師《封印》→ プレイヤーはこのラウンドのサポート使用不可"]});
    else if (playerSupportId) applySupport(match, "player", playerSupportId);
    if (match.supportLockNextRound.cpu) match.log.push({round:match.round,type:"support",lines:["封印術師《封印》→ CPUはこのラウンドのサポート使用不可"]});
    else if (!skipCpuSupport) chooseCpuSupport(match, rng, cpuSupportId);
    match.supportLockNextRound.player=false; match.supportLockNextRound.cpu=false;
    match.status = "handChoice";
  }
  function finishPairedSupportPhase(match, playerSupportId = null, cpuSupportId = null) {
    if (match.status !== "supportSelection") throw new Error("Not in support phase");
    for (const [sideId, supportId] of [["player", playerSupportId], ["cpu", cpuSupportId]]) {
      if (match.supportLockNextRound[sideId]) match.log.push({ round: match.round, type: "support", lines: [`${sideId === "player" ? "プレイヤー" : "CPU"}：封印中のためサポートを使わない`] });
      else if (supportId) applySupport(match, sideId, supportId);
    }
    match.supportLockNextRound.player = false;
    match.supportLockNextRound.cpu = false;
    match.status = "handChoice";
  }

  function shouldCpuReroll(card, rawDie, rpsResult, effects) {
    if (!effects.rerollAvailable) return false;
    const mod = (effects.suppressRpsDieModifier ? 0 : getRpsDieModifier(rpsResult)) + effects.supportDieModifier + effects.statusDieModifier;
    const currentDamage = getBasicDamage(card, clampFinalDie(rawDie + mod));
    const expectation = card.dice.reduce((sum, damage, index) => sum + card.dice[clampFinalDie(index + 1 + mod) - 1], 0) / 6;
    // Compare expected table damage instead of assuming low/high pips are good;
    // this preserves the Pixie Clown's intentionally reversed table.
    return expectation > currentDamage;
  }
  function startRpsAndRoll(match, playerHand, { rng = Math.random, cpuHand = null, autoCpuReroll = true } = {}) {
    if (match.status !== "handChoice") throw new Error("Not in hand-choice phase");
    const cpu = match.cpu;
    cpuHand ||= HANDS[Math.floor(rng() * HANDS.length)];
    runHooks(match.hooks, "beforeRps", { match, playerHand, cpuHand });
    const rpsResult = determineRps(playerHand, cpuHand);
    for (const [side, hand] of [[match.player,playerHand],[match.cpu,cpuHand]]) {
      const passive = side.activeCard && findPassive(side.activeCard.card, "damageBonusPerRockUse");
      if (passive && hand === (passive.condition?.hand || "rock")) {
        side.activeCard.rockUses++;
        const nextBonus = side.activeCard.accumulatedDamageBonus + passive.value;
        side.activeCard.accumulatedDamageBonus = passive.condition?.cap == null ? nextBonus : Math.min(nextBonus, passive.condition.cap);
        match.log.push({round:match.round,type:"ability",lines:[`${side.label}：${side.activeCard.card.name}《${passive.label || "蓄積"}》→ ${HAND_LABELS[hand]}使用${side.activeCard.rockUses}回、ダメージ+${side.activeCard.accumulatedDamageBonus}`]});
      }
    }
    runHooks(match.hooks, "afterRps", { match, playerHand, cpuHand, rpsResult });
    runHooks(match.hooks, "beforeDice", { match, playerHand, cpuHand, rpsResult });
    if([match.player, match.cpu].some(side => side.activeCard?.card.passives.some(passive => passive.kind === "suppressRpsDieModifier"))) {
      match.player.currentRoundEffects.suppressRpsDieModifier=true; match.cpu.currentRoundEffects.suppressRpsDieModifier=true;
    }
    const playerRolled = rollD6(rng); const cpuRolled = rollD6(rng);
    const playerRaw = match.player.currentRoundEffects.supportRawDieOverride ?? match.player.currentRoundEffects.statusRawDieOverride ?? playerRolled;
    const cpuRaw = cpu.currentRoundEffects.supportRawDieOverride ?? cpu.currentRoundEffects.statusRawDieOverride ?? cpuRolled;
    const playerData = { initialRaw: playerRaw, rawDie: playerRaw, rerolled: false, rerollAvailable: match.player.currentRoundEffects.rerollAvailable };
    const cpuData = { initialRaw: cpuRaw, rawDie: cpuRaw, rerolled: false, rerollAvailable: cpu.currentRoundEffects.rerollAvailable };
    runHooks(match.hooks,"afterRawDice",{match,playerData,cpuData,stage:"initial"});
    const cpuRps = rpsResult === "win" ? "loss" : rpsResult === "loss" ? "win" : "draw";
    for (const [side, result] of [[match.player, rpsResult], [match.cpu, cpuRps]]) {
      if (result !== "loss" || !side.activeCard) continue;
      const passive = findPassive(side.activeCard.card, "damageBonusPerRpsLoss");
      if (passive) {
        side.activeCard.accumulatedDamageBonus += passive.value;
        match.log.push({round:match.round,type:"ability",lines:[`${side.label}：${side.activeCard.card.name}《${passive.label || "蓄積"}》→ じゃんけん敗北、以後ダメージ+${side.activeCard.accumulatedDamageBonus}`]});
      }
    }
    if (autoCpuReroll && shouldCpuReroll(cpu.activeCard.card, cpuRaw, cpuRps, cpu.currentRoundEffects)) {
      cpuData.rawDie = rollD6(rng); cpuData.rerolled = true; cpu.currentRoundEffects.rerollAvailable = false;
      runHooks(match.hooks,"afterRawDice",{match,playerData,cpuData,actor:"cpu",stage:"reroll"});
    }
    match.pendingRound = { playerHand, cpuHand, rpsResult, playerData, cpuData, rng };
    match.status = "diceChoice";
    match.log.push({ round: match.round, type: "dice", lines: [
      `じゃんけん確定：プレイヤー ${HAND_LABELS[playerHand]} / CPU ${HAND_LABELS[cpuHand]} → ${rpsResult === "win" ? "プレイヤー勝利" : rpsResult === "loss" ? "CPU勝利" : "あいこ"}`,
      `生ダイス：プレイヤー ${playerRaw} / CPU ${cpuRaw}${cpuData.rerolled ? ` / CPUは振り直し ${cpuRaw} → ${cpuData.rawDie}` : ""}`
    ] });
    return match.pendingRound;
  }
  function decidePlayerReroll(match, reroll) {
    if (match.status !== "diceChoice") throw new Error("Not in dice-choice phase");
    const data = match.pendingRound.playerData;
    if (reroll && data.rerollAvailable) {
      const old = data.rawDie;
      data.rawDie = rollD6(match.pendingRound.rng);
      data.rerolled = true;
      match.player.currentRoundEffects.rerollAvailable = false;
      runHooks(match.hooks,"afterRawDice",{match,playerData:data,cpuData:match.pendingRound.cpuData,actor:"player",stage:"reroll"});
      match.log.push({ round: match.round, type: "reroll", lines: [`プレイヤー：振り直し ${old} → ${data.rawDie}（新しい出目を採用）`] });
    } else {
      if(data.rerollAvailable) match.log.push({ round: match.round, type: "reroll", lines: ["プレイヤー：振り直し権を使わず、現在の出目を採用"] });
    }
    data.rerollAvailable = false;
    return resolveDiceAndEffects(match);
  }
  function decideRerolls(match, choices, { rng = Math.random, deferRevives = false } = {}) {
    if (match.status !== "diceChoice") throw new Error("Not in dice-choice phase");
    for (const sideId of ["player", "cpu"]) {
      const side = match[sideId];
      const data = match.pendingRound[`${sideId}Data`];
      const reroll = Boolean(choices?.[sideId]) && data.rerollAvailable;
      if (reroll) {
        const old = data.rawDie;
        data.rawDie = rollD6(rng);
        data.rerolled = true;
        side.currentRoundEffects.rerollAvailable = false;
        runHooks(match.hooks, "afterRawDice", { match, playerData: match.pendingRound.playerData, cpuData: match.pendingRound.cpuData, actor: sideId, stage: "reroll" });
        match.log.push({ round: match.round, type: "reroll", lines: [`${side.label}：振り直し ${old} → ${data.rawDie}（新しい出目を採用）`] });
      } else if (data.rerollAvailable) {
        match.log.push({ round: match.round, type: "reroll", lines: [`${side.label}：振り直し権を使わず、現在の出目を採用`] });
      }
      data.rerollAvailable = false;
    }
    return resolveDiceAndEffects(match, { deferRevives });
  }

  function rolledDice(raw, rpsResult, effects) {
    const rpsModifier = effects.suppressRpsDieModifier ? 0 : getRpsDieModifier(rpsResult);
    const supportModifier = effects.supportDieModifier;
    const statusModifier = effects.statusDieModifier;
    const finalDie = clampFinalDie(raw + rpsModifier + supportModifier + statusModifier);
    return { rawDie: raw, rpsModifier, supportModifier, statusModifier, unclamped: raw+rpsModifier+supportModifier+statusModifier, finalDie };
  }
  function getTriggerEffects(card, finalDie) {
    return card.triggers.filter(trigger => trigger.die.includes(finalDie)).flatMap(trigger => trigger.effects);
  }
  function collectCardEffects(match, side, attack, hand, rpsResult) {
    const finalDie=attack.dice.finalDie;
    const triggered = getTriggerEffects(side.activeCard.card, finalDie);
    const output = { healing:0, healSources:[], shield:0, selfDamage:0, nextEffects:[], reviveCandidates:[], reviveHpPercent:50, reviveSourceUnit:null, log:[] };
    const unit=side.activeCard, name=unit.card.name;
    for (const passive of unit.card.passives) {
      const label = passive.label ? `《${passive.label}》` : "";
      switch (passive.kind) {
        case "damageBonus":
          if (passiveConditionMet(passive, side, hand, rpsResult)) {
            attack.passiveBonus += passive.value; attack.rawDamage += passive.value;
            output.log.push(`${name}${label} → 条件成立、ダメージ+${passive.value}`);
          }
          break;
        case "damageBonusPerGraveyardBattleCard": {
          const attribute = passive.condition?.attribute;
          const count = side.graveyard.filter(item => side.battleCards.find(card => card.instanceId === item.instanceId)?.card.attribute === attribute).length;
          const amount = Math.min(count * passive.value, passive.maximum ?? Infinity);
          attack.passiveBonus += amount; attack.rawDamage += amount;
          if (amount) output.log.push(`${name}${label} → 墓地の${ATTRIBUTE_LABEL[attribute] || ""}${count}枚、ダメージ+${amount}`);
          break;
        }
        case "damageBonusPerOpponentBattleCardRemaining": {
          const count = livingCards(side.id === "player" ? match.cpu : match.player).length;
          const amount = passive.value[count] || 0;
          attack.passiveBonus += amount; attack.rawDamage += amount;
          if (amount) output.log.push(`${name}${label} → 相手残り${count}枚、ダメージ+${amount}`);
          break;
        }
        case "heal":
          if (passiveConditionMet(passive, side, hand, rpsResult)) {
            output.healing += passive.value; output.healSources.push({name,amount:passive.value,label});
          }
          break;
        case "disableOpponentSupportNextRound":
          if (passiveConditionMet(passive, side, hand, rpsResult)) {
            const opponent = side.id === "player" ? "cpu" : "player";
            match.supportLockNextRound[opponent] = true;
            output.log.push(`${name}${label} → 次ラウンド相手はサポート使用不可`);
          }
          break;
        case "nextRoundDieModifier":
          if (passiveConditionMet(passive, side, hand, rpsResult)) {
            output.nextEffects.push({target:side.id,key:"dieModifier",value:passive.value});
            output.log.push(`${name}${label} → 次ラウンド自分のダイス+${passive.value}`);
          }
          break;
        case "formationScaling":
          if (unit.battleStartDamageBonus) output.log.push(`${name}${label || "《剣聖》"} → 編成${match.battleState.counters[side.id].startingBattleCardCount}枚、ダメージ+${unit.battleStartDamageBonus}`);
          break;
      }
    }
    for (const effect of triggered) {
      switch (effect.kind) {
        case "heal": output.healing += effect.value; output.healSources.push({name,amount:effect.value,label:""}); break;
        case "shield": output.shield += effect.value; output.log.push(`${side.activeCard.card.name}：最終${finalDie} → シールド${effect.value}`); break;
        case "selfDamage": output.selfDamage += effect.value; output.log.push(`${side.activeCard.card.name}：自分に${effect.value}ダメージ`); break;
        case "nextRoundDieModifier": output.nextEffects.push({ target: side.id, key:"dieModifier", value:effect.value }); output.log.push(`${side.activeCard.card.name}：次ラウンド自分のダイス${effect.value>=0?"+":""}${effect.value}`); break;
        case "nextRoundRawDieOverride": output.nextEffects.push({ target:side.id, key:"rawDieOverride", value:effect.value }); output.log.push(`${side.activeCard.card.name}：次ラウンドの補正前ダイスを${effect.value}にする`); break;
        case "nextRoundOpponentDieModifier": output.nextEffects.push({ target: side.id === "player" ? "cpu" : "player", key:"dieModifier", value:effect.value }); output.log.push(`${side.activeCard.card.name}：次ラウンド相手のダイス${effect.value}`); break;
        case "nextRoundOpponentDamageReduction": output.nextEffects.push({ target: side.id === "player" ? "cpu" : "player", key:"outgoingDamageReduction", value:effect.value }); output.log.push(`${side.activeCard.card.name}：相手の次ラウンドのダメージ-${effect.value}`); break;
        case "revive": {
          if(side.revivalUsed || (effect.condition?.usesPerBattle && unit.oncePerBattleUsed)) { output.log.push(`${name}：復活権は使用済み`); break; }
          output.reviveCandidates = side.graveyard.map(item => item.instanceId); output.reviveHpPercent=effect.condition?.hpPercent||50;
          if(output.reviveCandidates.length) output.reviveSourceUnit=unit;
          output.log.push(side.graveyard.length ? `${name}：墓地から復活候補を選択` : `${name}：墓地が空のため蘇生なし`); break;
        }
      }
    }
    return output;
  }
  function calcAttack(side, hand, rpsResult, dice) {
    const card = side.activeCard.card;
    const baseDamage = getBasicDamage(card, dice.finalDie);
    const expertBonus = getExpertHandBonus(card, hand, rpsResult);
    const supportDamage = side.currentRoundEffects.damageBonus;
    const unit=side.activeCard;
    const passiveBonus=unit.accumulatedDamageBonus+unit.battleStartDamageBonus;
    const rawDamage = baseDamage + expertBonus + supportDamage + passiveBonus;
    return { card, hand, dice, baseDamage, expertBonus, supportDamage, passiveBonus, rawDamage };
  }
  function resolveDamage(attackerAttack, attacker, defender, defenderEffects) {
    const opponentDamageReduction = attacker.currentRoundEffects.outgoingDamageReduction;
    const damageReduction = defender.currentRoundEffects.incomingDamageReduction;
    const shield = defenderEffects.shield;
    const finalDamage = Math.max(0, attackerAttack.rawDamage - opponentDamageReduction - damageReduction - shield);
    return { baseDamage:attackerAttack.baseDamage, expertBonus:attackerAttack.expertBonus, supportDamage:attackerAttack.supportDamage, opponentDamageReduction, damageReduction, shield, finalDamage };
  }
  function updateHistory(match, result, playerHand, cpuHand) {
    if (result === "draw") return;
    const winner = result === "win" ? "player" : "cpu"; const loser = winner === "player" ? "cpu" : "player";
    match.history[winner].rpsWins++; match.history[winner].handWins[winner === "player" ? playerHand : cpuHand]++;
    match.history[loser].rpsLosses++; match.history[loser].handLosses[loser === "player" ? playerHand : cpuHand]++;
  }
  function applyHpSimultaneously(player, cpu, playerAttackResult, cpuAttackResult, playerEffects, cpuEffects, rpsResult) {
    const pCard = player.activeCard; const cCard = cpu.activeCard;
    const pBefore = pCard.currentHp; const cBefore = cCard.currentHp;
    const pHealedTo = Math.min(pCard.maxHp, pBefore + playerEffects.healing);
    const cHealedTo = Math.min(cCard.maxHp, cBefore + cpuEffects.healing);
    const pEnd = pHealedTo - playerAttackResult.finalDamage - playerEffects.selfDamage;
    const cEnd = cHealedTo - cpuAttackResult.finalDamage - cpuEffects.selfDamage;
    const bothKO = pEnd <= 0 && cEnd <= 0;
    let pFinal = Math.max(0, pEnd); let cFinal = Math.max(0, cEnd); let simultaneousRule = null;
    if (bothKO) {
      if (rpsResult === "draw") { pFinal = 0; cFinal = 0; simultaneousRule = "draw-both-ko"; }
      else if (rpsResult === "win") { pFinal = 10; cFinal = 0; simultaneousRule = "rps-winner-survives-at-10"; }
      else { pFinal = 0; cFinal = 10; simultaneousRule = "rps-winner-survives-at-10"; }
    }
    pCard.currentHp = pFinal; cCard.currentHp = cFinal;
    return {
      player:{ before:pBefore, healedTo:pHealedTo, incoming:playerAttackResult.finalDamage, selfDamage:playerEffects.selfDamage, after:pFinal, knockedOut:pFinal<=0 },
      cpu:{ before:cBefore, healedTo:cHealedTo, incoming:cpuAttackResult.finalDamage, selfDamage:cpuEffects.selfDamage, after:cFinal, knockedOut:cFinal<=0 },
      bothKO, simultaneousRule
    };
  }
  function applyDeferredSupportEffects(side, hand, rpsResult, finalDie) {
    const effects = side.currentRoundEffects.deferredSupportEffects || [];
    for (const effect of effects) {
      const condition = effect.condition;
      const matches = condition.kind === "handIs" ? hand === condition.hand
        : condition.kind === "rpsResult" ? rpsResult === condition.result
        : condition.kind === "finalDieParity" ? (finalDie % 2 === 0) === (condition.parity === "even")
        : false;
      if (!matches) continue;
      if (effect.kind === "damageBonus") side.currentRoundEffects.damageBonus += effect.value;
      else if (effect.kind === "damageReduction") side.currentRoundEffects.incomingDamageReduction += effect.value;
    }
    side.currentRoundEffects.deferredSupportEffects = [];
  }
  function recordKO(side, hooks, round) {
    const card = side.activeCard;
    if (!card || card.currentHp > 0 || card.knockedOut) return null;
    card.knockedOut = true;
    const record = { instanceId:card.instanceId, cardId:card.cardId, name:card.card.name, round, slotIndex:card.slotIndex };
    side.graveyard.push(record); runHooks(hooks,"onKO",{side,card,record}); return record;
  }
  function moveAfterKO(side) {
    const old = side.activeCard;
    if (!old || old.currentHp > 0) return null;
    const total=side.battleCards.length;
    for (let step=1; step<=total; step++) {
      const index=(old.slotIndex+step)%total;
      const candidate=side.battleCards[index];
      if (!candidate.knockedOut && candidate.currentHp>0) {
        side.activeBattleCardIndex=index; candidate.hasEnteredBattle=true;
        return {from:old.card.name,to:candidate.card.name,slotIndex:index};
      }
    }
    side.activeBattleCardIndex=total;
    return {from:old.card.name,to:null,slotIndex:null};
  }
  function livingCards(side) { return side.battleCards.filter(card => !card.knockedOut && card.currentHp>0); }
  function reviveCard(side, instanceId, hpPercent = 50) {
    if(side.revivalUsed) return null;
    const index=side.graveyard.findIndex(item=>item.instanceId===instanceId);
    if(index<0) return null;
    const entry=side.graveyard[index];
    const card=side.battleCards.find(item=>item.instanceId===instanceId);
    if(!card) return null;
    side.graveyard.splice(index,1);
    card.knockedOut=false;
    side.revivalUsed=true;
    // Revival HP uses floor to keep all percentage-based revival results integral.
    card.currentHp=Math.floor(card.maxHp*hpPercent/100);
    if(!side.activeCard) { side.activeBattleCardIndex=card.slotIndex; card.hasEnteredBattle=true; }
    return {instanceId,cardId:card.cardId,name:card.card.name,hp:card.currentHp,maxHp:card.maxHp,slotIndex:card.slotIndex,previousSlot:entry.slotIndex};
  }
  function finalizeRound(match, entry) {
    const revivedNames=entry.revived.map(item=>`${item.name} HP${item.hp}/${item.maxHp}で元の枠${item.slotIndex+1}へ復活`);
    entry.lines.push(...revivedNames);
    const pLiving=livingCards(match.player).length; const cLiving=livingCards(match.cpu).length;
    if(pLiving===0&&cLiving===0&&entry.simultaneousRule==="draw-both-ko"&&entry.rpsResult==="draw") match.outcome="DRAW";
    else if(cLiving===0) match.outcome="WIN";
    else if(pLiving===0) match.outcome="LOSE";
    else match.outcome=null;
    match.status=match.outcome?"finished":"roundResolved";
    match.lastResultEntry=entry;
    match.log.push({round:match.round,type:"roundResult",entry,lines:entry.lines});
    runHooks(match.hooks,"afterRound",{match,entry});
    return entry;
  }
  function completeReviveChoice(match, instanceId) {
    if(match.status!=="reviveChoice"||!match.pendingRevive) throw new Error("No revive choice is pending");
    const target=match.pendingRevive.side;
    const revived=reviveCard(target,instanceId,match.pendingRevive.hpPercent);
    if(!revived) throw new Error("Invalid revival candidate");
    if(match.pendingRevive.sourceUnit?.card.triggers.some(trigger=>trigger.effects.some(effect=>effect.kind==="revive"&&effect.condition?.usesPerBattle))) match.pendingRevive.sourceUnit.oncePerBattleUsed=true;
    match.pendingRevive.entry.revived.push(revived);
    match.pendingRevive=null;
    const entry=match._pendingEntry;
    match._pendingEntry=null;
    return finalizeRound(match,entry);
  }
  function resolveDiceAndEffects(match, { deferRevives = false } = {}) {
    const pending=match.pendingRound; const p=match.player; const c=match.cpu;
    const arbiterActive=[p,c].some(side=>side.activeCard?.card.passives.some(passive=>passive.kind==="suppressRpsDieModifier"));
    p.currentRoundEffects.suppressRpsDieModifier ||= arbiterActive; c.currentRoundEffects.suppressRpsDieModifier ||= arbiterActive;
    const pDice=rolledDice(pending.playerData.rawDie,pending.rpsResult,p.currentRoundEffects);
    const cpuResult=pending.rpsResult==="win"?"loss":pending.rpsResult==="loss"?"win":"draw";
    const cDice=rolledDice(pending.cpuData.rawDie,cpuResult,c.currentRoundEffects);
    applyDeferredSupportEffects(p, pending.playerHand, pending.rpsResult, pDice.finalDie);
    applyDeferredSupportEffects(c, pending.cpuHand, cpuResult, cDice.finalDie);
    runHooks(match.hooks,"afterFinalDice",{match,pDice,cDice});
    const pAttack=calcAttack(p,pending.playerHand,pending.rpsResult,pDice);
    const cAttack=calcAttack(c,pending.cpuHand,cpuResult,cDice);
    const pEffects=collectCardEffects(match,p,pAttack,pending.playerHand,pending.rpsResult); const cEffects=collectCardEffects(match,c,cAttack,pending.cpuHand,cpuResult);
    pEffects.selfDamage+=p.currentRoundEffects.selfDamage;
    cEffects.selfDamage+=c.currentRoundEffects.selfDamage;
    const pDamage=resolveDamage(cAttack,c,p,pEffects); const cDamage=resolveDamage(pAttack,p,c,cEffects);
    runHooks(match.hooks,"beforeDamage",{match,pAttack,cAttack,pDamage,cDamage,pEffects,cEffects});
    const hp=applyHpSimultaneously(p,c,pDamage,cDamage,pEffects,cEffects,pending.rpsResult);
    for(const [effects,change] of [[pEffects,hp.player],[cEffects,hp.cpu]]) {
      let remaining=change.healedTo-change.before;
      for(const source of effects.healSources) { const amount=Math.min(source.amount,remaining); remaining-=amount; if(amount) effects.log.push(`${source.name}${source.label}：${amount}回復`); }
    }
    runHooks(match.hooks,"afterDamage",{match,hp,pDamage,cDamage});
    const kos={player:null,cpu:null};
    if(hp.player.knockedOut) kos.player=recordKO(p,match.hooks,match.round);
    if(hp.cpu.knockedOut) kos.cpu=recordKO(c,match.hooks,match.round);
    if(kos.player) match.history.player.cardKOs++;
    if(kos.cpu) match.history.cpu.cardKOs++;
    const switches={player:null,cpu:null};
    if(kos.player) switches.player=moveAfterKO(p);
    if(kos.cpu) switches.cpu=moveAfterKO(c);
    for(const next of [...pEffects.nextEffects,...cEffects.nextEffects]) {
      if (next.key === "rawDieOverride") match[next.target].pendingRoundEffects.rawDieOverride = next.value;
      else match[next.target].pendingRoundEffects[next.key]+=next.value;
    }
    const entry={round:match.round,playerHand:pending.playerHand,cpuHand:pending.cpuHand,rpsResult:pending.rpsResult,
      playerDice:pDice,cpuDice:cDice,playerAttack:pAttack,cpuAttack:cAttack,playerDamage:cDamage,cpuDamage:pDamage,
      playerRerolled:pending.playerData.rerolled,cpuRerolled:pending.cpuData.rerolled,
      playerEffects:pEffects,cpuEffects:cEffects,hp,kos,switches,simultaneousRule:hp.simultaneousRule,revived:[],lines:[]};
    match.lastResultEntry=entry;
    entry.lines.push(`ROUND ${entry.round}`,`プレイヤー：${HAND_LABELS[entry.playerHand]} / CPU：${HAND_LABELS[entry.cpuHand]} → ${entry.rpsResult==="win"?"プレイヤー勝利":entry.rpsResult==="loss"?"CPU勝利":"あいこ"}`);
    if(arbiterActive&&entry.rpsResult!=="draw") entry.lines.push("調停者《調停》→ 両者のじゃんけん由来ダイス補正を無効化");
    entry.lines.push(diceLine("プレイヤー",pDice),diceLine("CPU",cDice));
    entry.lines.push(damageLine("プレイヤー→CPU",pAttack,cDamage),damageLine("CPU→プレイヤー",cAttack,pDamage));
    for(const [label,change] of [["プレイヤー",hp.player],["CPU",hp.cpu]]) {
      const details=[]; if(change.healedTo>change.before) details.push(`回復後HP${change.healedTo}`);
      if(change.incoming) details.push(`被ダメージ${change.incoming}`); if(change.selfDamage) details.push(`自傷${change.selfDamage}`);
      if(details.length||change.knockedOut) entry.lines.push(`${label}：${details.join(" / ")}${details.length?" → ":""}HP${change.after}${change.knockedOut?"（KO）":""}`);
    }
    entry.lines.push(...pEffects.log,...cEffects.log);
    if(kos.player) entry.lines.push(`プレイヤー：${kos.player.name}がKO`);
    if(kos.cpu) entry.lines.push(`CPU：${kos.cpu.name}がKO`);
    if(entry.simultaneousRule==="rps-winner-survives-at-10") entry.lines.push("同時KO：じゃんけん勝者側はHP10で生存");
    if(entry.simultaneousRule==="draw-both-ko") entry.lines.push("同時KO：あいこのため両カードKO");
    if(switches.player?.to) entry.lines.push(`プレイヤーの次カード：${switches.player.to}`);
    if(switches.cpu?.to) entry.lines.push(`CPUの次カード：${switches.cpu.to}`);
    entry.debugLines=[
      `詳細計算：プレイヤー生${pDice.rawDie} / RPS${pDice.rpsModifier} / サポート${pDice.supportModifier} / 状態${pDice.statusModifier} / 最終${pDice.finalDie}`,
      `詳細計算：CPU生${cDice.rawDie} / RPS${cDice.rpsModifier} / サポート${cDice.supportModifier} / 状態${cDice.statusModifier} / 最終${cDice.finalDie}`,
      `詳細計算：プレイヤー攻撃 基本${pAttack.baseDamage} + 得意手${pAttack.expertBonus} + サポート${pAttack.supportDamage} + 固有能力${pAttack.passiveBonus} = ${pAttack.rawDamage}`,
      `詳細計算：CPU攻撃 基本${cAttack.baseDamage} + 得意手${cAttack.expertBonus} + サポート${cAttack.supportDamage} + 固有能力${cAttack.passiveBonus} = ${cAttack.rawDamage}`,
      `詳細計算：プレイヤー被ダメージ ${cDamage.finalDamage}（相手低下${cDamage.opponentDamageReduction} / 軽減${cDamage.damageReduction} / シールド${cDamage.shield}）; CPU被ダメージ ${pDamage.finalDamage}（相手低下${pDamage.opponentDamageReduction} / 軽減${pDamage.damageReduction} / シールド${pDamage.shield}）`,
      `詳細HP：プレイヤー ${hp.player.before} + 回復${hp.player.healedTo-hp.player.before} - 被ダメージ${hp.player.incoming} - 自傷${hp.player.selfDamage} = ${hp.player.after}; CPU ${hp.cpu.before} + 回復${hp.cpu.healedTo-hp.cpu.before} - 被ダメージ${hp.cpu.incoming} - 自傷${hp.cpu.selfDamage} = ${hp.cpu.after}`
    ];
    updateHistory(match,pending.rpsResult,pending.playerHand,pending.cpuHand);
    const reviveRequests=[];
    if(pEffects.reviveCandidates.length) reviveRequests.push({side:p,sideId:"player",candidates:pEffects.reviveCandidates});
    if(cEffects.reviveCandidates.length) reviveRequests.push({side:c,sideId:"cpu",candidates:cEffects.reviveCandidates});
    const deferredRevives=[];
    for(const request of reviveRequests) {
      const options=request.candidates.filter(id=>request.side.graveyard.some(item=>item.instanceId===id));
      if(!options.length) continue;
      if(deferRevives && options.length>1) {
        deferredRevives.push({side:request.side,sideId:request.sideId,candidates:options,hpPercent:(request.sideId==="player"?pEffects:cEffects).reviveHpPercent,sourceUnit:(request.sideId==="player"?pEffects:cEffects).reviveSourceUnit});
        continue;
      }
      if(request.sideId==="cpu") {
        const chosen=options.map(id=>request.side.battleCards.find(item=>item.instanceId===id)).sort((a,b)=>b.maxHp-a.maxHp)[0];
        const effects=request.side===p?pEffects:cEffects;
        const revived=reviveCard(request.side,chosen.instanceId,effects.reviveHpPercent); if(revived) { entry.revived.push(revived); if(effects.reviveSourceUnit?.card.triggers.some(trigger=>trigger.effects.some(effect=>effect.kind==="revive"&&effect.condition?.usesPerBattle))) effects.reviveSourceUnit.oncePerBattleUsed=true; }
      } else if(options.length===1) {
        const effects=request.side===p?pEffects:cEffects;
        const revived=reviveCard(request.side,options[0],effects.reviveHpPercent); if(revived) { entry.revived.push(revived); if(effects.reviveSourceUnit?.card.triggers.some(trigger=>trigger.effects.some(effect=>effect.kind==="revive"&&effect.condition?.usesPerBattle))) effects.reviveSourceUnit.oncePerBattleUsed=true; }
      } else {
        const effects=request.side===p?pEffects:cEffects;
        match._pendingEntry=entry; match.pendingRevive={side:request.side,candidates:options,entry,hpPercent:effects.reviveHpPercent,sourceUnit:effects.reviveSourceUnit}; match.status="reviveChoice"; match.pendingRound=null;
        return entry;
      }
    }
    if(deferredRevives.length) {
      match.pendingRound=null;
      match.pendingRevives=deferredRevives;
      match._pendingEntry=entry;
      match.status="reviveChoice";
      return entry;
    }
    match.pendingRound=null;
    return finalizeRound(match,entry);
  }
  function completeOnlineRevives(match, choices) {
    if(match.status!=="reviveChoice"||!Array.isArray(match.pendingRevives)||!match.pendingRevives.length) throw new Error("No online revival choices are pending");
    const entry=match._pendingEntry;
    for(const request of match.pendingRevives) {
      const instanceId=choices?.[request.sideId];
      if(!request.candidates.includes(instanceId)) throw new Error("Invalid online revival choice");
      const revived=reviveCard(request.side,instanceId,request.hpPercent);
      if(!revived) throw new Error("Online revival failed");
      if(request.sourceUnit?.card.triggers.some(trigger=>trigger.effects.some(effect=>effect.kind==="revive"&&effect.condition?.usesPerBattle))) request.sourceUnit.oncePerBattleUsed=true;
      entry.revived.push(revived);
    }
    match.pendingRevives=null;
    match._pendingEntry=null;
    return finalizeRound(match,entry);
  }
  function diceLine(label,dice) {
    const parts=[`生ダイス${dice.rawDie}`];
    if(dice.rpsModifier) parts.push(`じゃんけん${dice.rpsModifier>0?"+":""}${dice.rpsModifier}`);
    if(dice.supportModifier) parts.push(`サポート${dice.supportModifier>0?"+":""}${dice.supportModifier}`);
    if(dice.statusModifier) parts.push(`前ラウンド${dice.statusModifier>0?"+":""}${dice.statusModifier}`);
    parts.push(`最終${dice.finalDie}`); return `${label}：${parts.join(" → ")}`;
  }
  function damageLine(label,attack,defense) {
    const adjustments=[];
    if(attack.expertBonus) adjustments.push({op:"+",text:`得意手${attack.expertBonus}`});
    if(attack.supportDamage) adjustments.push({op:"+",text:`サポート${attack.supportDamage}`});
    if(attack.passiveBonus) adjustments.push({op:"+",text:`固有能力${attack.passiveBonus}`});
    if(defense.opponentDamageReduction) adjustments.push({op:"-",text:`相手ダメージ低下${defense.opponentDamageReduction}`});
    if(defense.damageReduction) adjustments.push({op:"-",text:`受ける軽減${defense.damageReduction}`});
    if(defense.shield) adjustments.push({op:"-",text:`シールド${defense.shield}`});
    if(!adjustments.length) return `${label}：${attack.card.name} → ${defense.finalDamage}ダメージ`;
    let formula=`基本${attack.baseDamage}`;
    for(const term of adjustments) formula+=` ${term.op} ${term.text}`;
    return `${label}：${attack.card.name} → ${formula} = ${defense.finalDamage}ダメージ`;
  }
  function advanceRound(match) {
    if(match.status!=="roundResolved") return false;
    match.round++;
    freshRoundEffects(match.player); freshRoundEffects(match.cpu);
    match.status="supportSelection";
    match.log.push({round:match.round,type:"roundStart",lines:[`ROUND ${match.round}：ラウンド開始`]});
    runHooks(match.hooks,"beforeRound",{match,round:match.round});
    return true;
  }
  function formatLog(item, detail = false) { return (detail && (item.debugLines || item.entry?.debugLines)) || item.lines || item.entry?.lines || []; }
  function getReviveCandidates(match,sideId) {
    const side=match[sideId]; return side.graveyard.map(entry=>({instanceId:entry.instanceId,cardId:entry.cardId,name:entry.name,maxHp:side.battleCards.find(card=>card.instanceId===entry.instanceId)?.maxHp||0}));
  }

  window.BattleEngine={HANDS,HAND_LABELS,ATTRIBUTE_HAND,determineRps,rollD6,getRpsDieModifier,clampFinalDie,getBasicDamage,getExpertHandBonus,createHookSet,createSide,createMatch,conditionMet,effectValue,effectSummary,applySupport,chooseCpuSupport,finishSupportPhase,finishPairedSupportPhase,shouldCpuReroll,startRpsAndRoll,decidePlayerReroll,decideRerolls,rolledDice,getTriggerEffects,collectCardEffects,calcAttack,resolveDamage,applyHpSimultaneously,recordKO,moveAfterKO,livingCards,reviveCard,completeReviveChoice,completeOnlineRevives,resolveDiceAndEffects,advanceRound,formatLog,getReviveCandidates};
  if(typeof module!=="undefined"&&module.exports) module.exports=window.BattleEngine;
})();
