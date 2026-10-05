/* Formation screens and battle UI. Battle and card effects are resolved in battle.js/cards.js. */
(() => {
  const MAX_BATTLE_CARDS = 5;
  const byId = new Map(window.CARD_DATA.map(card => [card.id, card]));
  const devPool = window.DEV_CARD_POOL_CONFIG;
  const allPoolCards = window.CARD_DATA.map(card => ({instanceId:card.id,cardId:card.id}));
  let poolSelectionIds = [...devPool.initialPlayerSelection];
  let playerOwned = makeOwnedCards(poolSelectionIds, "player");
  let cpuRoster = window.CPU_DECK.generateRoster(window.CARD_DATA);
  let cpuOwned = cpuRoster.owned;
  let cpuBattleIds = [];
  const selectedOrder = [];
  let activeFilter = "all";
  let selectedSupportId = null;
  let toastTimer;
  let match = null;
  let onlineBattleMode = false;
  let onlineBattleController = null;
  let onlineBattleStatus = "";

  function makeOwnedCards(deck, prefix) {
    return deck.map((cardId, index) => ({ instanceId: `${prefix}-${String(index + 1).padStart(2, "0")}`, cardId }));
  }
  const $ = selector => document.querySelector(selector);
  const grid = $("#cardGrid");
  const poolGrid = $("#poolGrid");
  const engine = window.BattleEngine;
  function refreshCpuDeck() {
    cpuRoster = window.CPU_DECK.generateRoster(window.CARD_DATA);
    cpuOwned = cpuRoster.owned;
    cpuBattleIds = window.CPU_DECK.chooseBattleIds(cpuOwned.map(item => item.cardId), byId, MAX_BATTLE_CARDS);
    renderCpuPreview();
  }
  function renderCpuPreview() {
    const battleSet = new Set(cpuBattleIds);
    const battle = cpuOwned.filter(item => battleSet.has(item.cardId));
    const support = cpuOwned.filter(item => !battleSet.has(item.cardId));
    const rows = list => list.map(item => teamRow(item, "", false)).join("");
    $("#cpuRareCount").textContent = cpuRoster.rareCount;
    $("#cpuBattlePreview").innerHTML = rows(battle);
    $("#cpuSupportPreview").innerHTML = rows(support);
  }
  function setPhase(number, label) {
    $("#phaseNumber").textContent = number;
    $("#phaseLabel").textContent = label;
  }

  function conditionText(condition) {
    if (!condition) return "";
    if (typeof condition === "object") {
      if (condition.condition === "rockPaperScissorsWin") {
        const hand = { rock: "グー", paper: "パー", scissors: "チョキ" }[condition.hand];
        return hand ? `${hand}でじゃんけん勝利` : "じゃんけん勝利";
      }
      const nestedHpThreshold = typeof condition.condition === "string" && condition.condition.match(/^currentHpAtMost:(\d+(?:\.\d+)?)%$/);
      if (nestedHpThreshold) return `HP${nestedHpThreshold[1]}%以下`;
      if (condition.source === "graveyard") return `墓地から復活（最大HP${condition.hpPercent}%）`;
      if (condition.duration === "thisRound") return "そのラウンド";
      if (condition.attribute && condition.maximum != null) return `墓地の${window.CARD_ATTRIBUTE_LABELS[condition.attribute]}バトルカード参照`;
      if (condition.attribute) return `${window.CARD_ATTRIBUTE_LABELS[condition.attribute]}属性のカード参照`;
      return "条件付き";
    }
    const hpThreshold = condition.match(/^currentHpAtMost:(\d+(?:\.\d+)?)%$/);
    if (hpThreshold) return `HP${hpThreshold[1]}%以下`;
    if (condition.startsWith("currentBattleAttribute:")) return `${window.CARD_ATTRIBUTE_LABELS[condition.split(":")[1]]}カードが場にいる時`;
    return condition;
  }
  function hpConditionMet(condition, unit) {
    const text = typeof condition === "object" ? condition.condition : condition;
    const match = typeof text === "string" && text.match(/^currentHpAtMost:(\d+(?:\.\d+)?)%$/);
    return !!match && unit.currentHp <= unit.maxHp * Number(match[1]) / 100;
  }
  function effectText(item) {
    const amount = item.value;
    const c = conditionText(item.condition);
    const when = c ? `（${c}）` : "";
    const alternative = item.conditional ? `（${conditionText(item.conditional.condition).replace("カードが場にいる時", "なら")}+${item.conditional.value}）` : "";
    switch (item.kind) {
      case "damageBonus": return `ダメージ+${amount}${alternative || when}`;
      case "damageReduction": return `受けるダメージ-${amount}${item.conditional ? `（${conditionText(item.conditional.condition).replace("カードが場にいる時", "なら")}-${item.conditional.value}）` : when}`;
      case "heal": return `${amount}回復${alternative || when}`;
      case "selfDamage": return `自分に${amount}ダメージ`;
      case "shield": return `シールド${amount}`;
      case "dieModifier": return item.attributeBonus ? `自分のダイス+${amount}（${window.CARD_ATTRIBUTE_LABELS[item.attribute]}カードが場にいれば+${item.attributeBonus}）` : `自分のダイス+${amount}${when}`;
      case "opponentDieModifier": return `相手のダイス${amount < 0 ? amount : `+${amount}`}${item.conditional ? `（${conditionText(item.conditional.condition).replace("カードが場にいる時", "なら")}${item.conditional.value}）` : when}`;
      case "nextRoundDieModifier": return `次ラウンド自分のダイス+${amount}${when}`;
      case "nextRoundOpponentDieModifier": return `次ラウンド相手のダイス${amount}`;
      case "nextRoundOpponentDamageReduction": return `次ラウンド相手のダメージ-${amount}`;
      case "nextOpponentDamageReduction": return `相手の次のダメージ-${amount}`;
      case "reroll": return "振り直し";
      case "revive": return `${conditionText(item.condition) || `墓地から1枚復活（最大HP${amount}%）`}${item.condition?.usesPerBattle ? `（1バトル${item.condition.usesPerBattle}回まで）` : ""}`;
      case "opponentDamageReduction": return `相手のダメージ-${amount}${when}`;
      case "disableOpponentSupportNextRound": return `${window.BattleEngine.HAND_LABELS[item.condition?.hand]||"じゃんけん"}で勝つと、相手は次ラウンドのサポート使用不可`;
      case "maxHpBonusPerOtherBattleCard": return `開始時、他の${window.CARD_ATTRIBUTE_LABELS[item.condition?.attribute]||"バトル"}バトルカード1枚につき最大HP+${amount}`;
      case "damageBonusPerGraveyardBattleCard": return `墓地の${window.CARD_ATTRIBUTE_LABELS[item.condition?.attribute]||""}バトルカード1枚につきダメージ+${amount}${item.maximum==null?"（上限なし）":`（最大+${item.maximum}）`}`;
      case "damageBonusPerRockUse": return `${window.BattleEngine.HAND_LABELS[item.condition?.hand||"rock"]}使用ごとに以後ダメージ+${amount}${item.condition?.cap==null?"（上限なし）":`（最大+${item.condition.cap}）`}`;
      case "formationScaling": return "編成枚数に応じてHP・ダメージ補正が変化";
      case "suppressRpsDieModifier": return "両者のじゃんけん結果によるダイス補正を0にする";
      case "damageBonusPerOpponentBattleCardRemaining": return `相手の残りバトルカード数：${Object.entries(item.value).sort((a,b)=>Number(b[0])-Number(a[0])).map(([count,value])=>`${count}枚+${value}`).join(" / ")}`;
      default: return item.kind;
    }
  }
  function supportText(card) { return (card.supportOverrides || card.support).map(effectText).join(" / "); }
  function abilityLines(card) {
    const lines = [];
    if (card.triggers.length) lines.push(`<div class="ability"><strong>ダイス効果</strong>${card.triggers.map(t => `出目${t.die.join("・")}: ${t.effects.map(effectText).join(" / ")}`).join("<br>")}</div>`);
    lines.push(`<div class="ability"><strong>サポート</strong>${supportText(card)}</div>`);
    if (card.rarity === "rare") {
      const unique = card.passives.map(item => item.kind === "formationScaling"
        ? `編成枚数別：${Object.entries(item.value).map(([count, values]) => `${count}枚 HP${values.hp} / ダメージ+${values.damageBonus}`).join(" · ")}`
        : effectText(item));
      unique.push(...card.unresolved.map(x => x.note));
      if (unique.length) lines.push(`<div class="ability unique"><strong>固有能力</strong>${unique.join(" / ")}</div>`);
    }
    if (card.description) lines.push(`<div class="ability"><strong>補足</strong>${card.description}</div>`);
    return lines.join("");
  }
  function renderFormationCard(owned, selectedIds = selectedOrder, options = {}) {
    const card = byId.get(owned.cardId || owned.definitionId);
    if (!card) return "";
    const index = selectedIds.indexOf(owned.instanceId);
    const selected = index >= 0;
    const label = window.CARD_ATTRIBUTE_LABELS[card.attribute];
    const locked = Boolean(options.locked);
    const role = options.showRole ? `<span class="formation-role ${selected ? "is-battle" : "is-support"}">${selected ? "⚔ バトル" : "✦ サポート"}</span>` : "";
    return `<div class="formation-card-shell"><article class="game-card ${selected ? "selected" : ""}" data-instance="${owned.instanceId}" role="button" tabindex="${locked ? "-1" : "0"}" aria-disabled="${locked}" aria-pressed="${selected}" aria-label="${card.name}、${label}、${window.CARD_RARITY_LABELS[card.rarity]}、HP ${card.baseHp}${selected ? `、選択順${index + 1}` : ""}">
      <span class="selection-strip"></span><div class="card-top" style="--attribute:var(--${card.attribute})"></div><div class="card-inner">
      <div class="card-flags"><span class="rarity ${card.rarity}">${window.CARD_RARITY_LABELS[card.rarity]}</span><span class="attribute-label" style="--attribute:var(--${card.attribute})"><i class="attr-dot ${card.attribute}"></i>${label}</span>${role}${selected ? `<span class="order-number">${index + 1}</span>` : ""}</div>
      <h2 class="card-name">${card.name}</h2><div class="card-hp"><b>${card.baseHp}</b> HP</div><div class="dice-label">DICE TABLE <span>· 1—6</span></div><div class="dice-row">${card.dice.map(value => `<span class="die">${value}</span>`).join("")}</div>${abilityLines(card)}</div></article><button type="button" class="formation-card-detail" data-formation-detail="${card.id}">詳細</button></div>`;
  }
  function renderCard(owned) { return renderFormationCard(owned, selectedOrder); }
  function renderPoolCard(owned) {
    const card=byId.get(owned.cardId);
    const index=poolSelectionIds.indexOf(card.id);
    const selected=index>=0;
    const label=window.CARD_ATTRIBUTE_LABELS[card.attribute];
    return `<article class="game-card ${selected?"selected":""}" data-pool-card="${card.id}" role="checkbox" aria-checked="${selected}" tabindex="0" aria-label="${card.name}、${label}、${window.CARD_RARITY_LABELS[card.rarity]}、HP ${card.baseHp}${selected?`、所持カード選択済み`:""}">
      <span class="selection-strip"></span><div class="card-top" style="--attribute:var(--${card.attribute})"></div><div class="card-inner"><div class="card-flags"><span class="rarity ${card.rarity}">${window.CARD_RARITY_LABELS[card.rarity]}</span><span class="attribute-label" style="--attribute:var(--${card.attribute})"><i class="attr-dot ${card.attribute}"></i>${label}</span>${selected?`<span class="order-number">✓</span>`:""}</div><h2 class="card-name">${card.name}</h2><div class="card-hp"><b>${card.baseHp}</b> HP</div><div class="dice-label">DICE TABLE <span>· 1—6</span></div><div class="dice-row">${card.dice.map(value=>`<span class="die">${value}</span>`).join("")}</div>${abilityLines(card)}</div></article>`;
  }
  function renderPoolGrid() {
    const visible=activeFilter==="all"?allPoolCards:allPoolCards.filter(owned=>byId.get(owned.cardId).attribute===activeFilter);
    poolGrid.innerHTML=visible.map(renderPoolCard).join("");
    $("#poolCount").textContent=poolSelectionIds.length;
    $("#poolBottomCount").textContent=poolSelectionIds.length;
    $("#poolContinue").disabled=poolSelectionIds.length!==15;
  }
  function renderGrid() {
    const visible = activeFilter === "all" ? playerOwned : playerOwned.filter(owned => byId.get(owned.cardId).attribute === activeFilter);
    grid.innerHTML = visible.map(renderCard).join("");
  }
  function updateCounts() {
    const battle = selectedOrder.length;
    const support = playerOwned.length - battle;
    $("#ownedCount").textContent = playerOwned.length;
    $("#battleCount").textContent = battle;
    $("#supportCount").textContent = support;
    $("#filterAllCount").textContent = playerOwned.length;
    $("#bottomBattle").textContent = `バトル ${battle} / ${MAX_BATTLE_CARDS}`;
    $("#bottomSupport").textContent = `サポート ${support}`;
    $("#meterLabel").textContent = battle;
    $("#meterFill").style.width = `${battle / MAX_BATTLE_CARDS * 100}%`;
    $("#startButton").disabled = battle === 0 || battle > MAX_BATTLE_CARDS;
    const rareCount = playerOwned.filter(item => byId.get(item.cardId).rarity === "rare").length;
    $("#playerRareCount").textContent = rareCount;
    $("#playerRareSummary").textContent = `Rare ${rareCount}枚`;
  }
  function notify(message) {
    const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 1900);
  }
  function toggleSelection(instanceId) {
    const index = selectedOrder.indexOf(instanceId);
    if (index >= 0) selectedOrder.splice(index, 1);
    else if (selectedOrder.length >= MAX_BATTLE_CARDS) { notify("バトルカードは最大5枚までです"); return; }
    else selectedOrder.push(instanceId);
    renderGrid(); updateCounts();
  }
  function teamRow(owned, order, battle) {
    const card = byId.get(owned.cardId);
    const label = window.CARD_ATTRIBUTE_LABELS[card.attribute];
    return `<div class="team-row" style="--attribute:var(--${card.attribute})"><span class="team-order">${battle ? order : "✦"}</span><i class="team-color"></i><div class="team-info"><b>${card.name}</b><small>${label} · ${window.CARD_RARITY_LABELS[card.rarity]}</small></div><span class="team-hp">${card.baseHp} HP</span></div>`;
  }
  function showComplete() {
    if (selectedOrder.length < 1 || selectedOrder.length > MAX_BATTLE_CARDS) return;
    const battle = selectedOrder.map(id => playerOwned.find(c => c.instanceId === id));
    const supportCards = playerOwned.filter(c => !selectedOrder.includes(c.instanceId));
    $("#battleList").innerHTML = battle.map((owned, i) => teamRow(owned, i + 1, true)).join("");
    $("#supportList").innerHTML = supportCards.map(owned => teamRow(owned, "", false)).join("");
    $("#completeBattleCount").textContent = `${battle.length}枚`;
    $("#completeSupportCount").textContent = `${supportCards.length}枚`;
    $("#playerRareSummary").textContent = `Rare ${playerOwned.filter(item => byId.get(item.cardId).rarity === "rare").length}枚`;
    $("#startView").hidden=true; $("#poolView").hidden=true; $("#buildView").hidden = true; $("#completeView").hidden = false; $("#battleView").hidden = true;
    setPhase("PHASE 02", "編成");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showBuild(clear = false) {
    match = null;
    if (clear) selectedOrder.length = 0;
    selectedSupportId = null;
    $("#startView").hidden=true; $("#battleView").hidden = true; $("#completeView").hidden = true; $("#poolView").hidden=true; $("#buildView").hidden = false;
    setPhase("PHASE 02", "編成");
    renderGrid(); updateCounts(); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function beginBattle() {
    if (selectedOrder.length < 1) return;
    const cpuOrder = cpuBattleIds.map(id => cpuOwned.find(item => item.cardId === id).instanceId);
    match = engine.createMatch({ playerOwned: playerOwned.map(item => ({...item})), playerOrder: [...selectedOrder], cpuOwned: cpuOwned.map(item => ({...item})), cpuOrder, cardMap: byId });
    $("#startView").hidden=true; $("#buildView").hidden = true; $("#completeView").hidden = true; $("#battleView").hidden = false;
    setPhase("PHASE 03", "バトル");
    selectedSupportId = null;
    renderBattle(); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showPool() {
    match=null; selectedSupportId=null;
    $("#startView").hidden=true; $("#poolView").hidden=false; $("#buildView").hidden=true; $("#completeView").hidden=true; $("#battleView").hidden=true;
    setPhase("PHASE 01","カードプール"); renderPoolGrid(); window.scrollTo({top:0,behavior:"smooth"});
  }
  function showHome() {
    match=null;
    for (const id of ["poolView","buildView","completeView","battleView"]) $(`#${id}`).hidden=true;
    $("#startView").hidden=false;
    setPhase("PHASE 00","スタート"); window.scrollTo({top:0,behavior:"smooth"});
  }
  function quickStart() {
    generatePlayerDeck();
    refreshCpuDeck();
    showBuild(false);
  }
  function startManualBuild() {
    refreshCpuDeck();
    showPool();
  }
  function rematchRandomBoth() {
    generatePlayerDeck();
    refreshCpuDeck();
    showBuild(false);
  }
  function acceptPoolSelection() {
    if(poolSelectionIds.length!==15)return;
    playerOwned=makeOwnedCards(poolSelectionIds,"player");
    selectedOrder.length=0; showBuild(false);
  }
  function generatePlayerDeck() {
    const roster = window.CPU_DECK.generateRoster(window.CARD_DATA);
    poolSelectionIds = roster.owned.map(item => item.cardId);
    playerOwned = makeOwnedCards(poolSelectionIds, "player");
    selectedOrder.length = 0;
    renderPoolGrid(); updateCounts();
  }
  function autoOrganizePlayer() {
    const battleIds = window.CPU_DECK.chooseBattleIds(playerOwned.map(item => item.cardId), byId, MAX_BATTLE_CARDS);
    selectedOrder.splice(0, selectedOrder.length, ...battleIds.map(id => playerOwned.find(item => item.cardId === id).instanceId));
    renderGrid(); updateCounts();
  }
  function prepareBothRandom() {
    generatePlayerDeck();
    autoOrganizePlayer();
    refreshCpuDeck();
    showComplete();
  }
  function rematchSameCpu() { beginBattle(); }
  function rematchNewCpu() { refreshCpuDeck(); beginBattle(); }
  function togglePoolCard(cardId) {
    const index=poolSelectionIds.indexOf(cardId);
    if(index>=0) poolSelectionIds.splice(index,1);
    else if(poolSelectionIds.length>=15) { notify("所持カードは15枚までです"); return; }
    else poolSelectionIds.push(cardId);
    renderPoolGrid();
  }
  function selectAllRarePool() {
    poolSelectionIds=window.CARD_DATA.filter(card=>card.rarity==="rare").map(card=>card.id);
    poolSelectionIds.push(...window.CARD_DATA.filter(card=>card.rarity==="normal").slice(0,3).map(card=>card.id));
    renderPoolGrid();
  }
  function cardSpecialNote(card, side) {
    if (card.rarity === "rare") {
      const unit=side.activeCard;
      let state="";
      const passive=kind=>card.passives.find(item=>item.kind===kind);
      const revenge=passive("damageBonusPerGraveyardBattleCard");
      if(revenge) { const attribute=revenge.condition?.attribute; const n=side.graveyard.filter(x=>side.battleCards.find(c=>c.instanceId===x.instanceId)?.card.attribute===attribute).length; const bonus=Math.min(n*revenge.value,revenge.maximum??Infinity); state=`墓地の${window.CARD_ATTRIBUTE_LABELS[attribute]}：${n} → ダメージ+${bonus}`; }
      const fist=passive("damageBonusPerRockUse");
      if(fist) state=`${window.BattleEngine.HAND_LABELS[fist.condition?.hand||"rock"]}使用：${unit.rockUses}回 → ダメージ+${unit.accumulatedDamageBonus}`;
      const reverse=card.passives.find(item=>item.kind==="damageBonus"&&typeof item.condition==="object"&&item.condition.condition==="rockPaperScissorsWin");
      if(reverse) state=`${window.BattleEngine.HAND_LABELS[reverse.condition.hand]}でじゃんけん勝利 → ダメージ+${reverse.value}`;
      const sea=passive("maxHpBonusPerOtherBattleCard");
      if(sea) state=`${sea.label||"最大HP補正"}：最大HP+${unit.battleStartHpBonus}（現在${unit.maxHp}）`;
      const sealer=passive("disableOpponentSupportNextRound");
      if(sealer) state=match.supportLockNextRound[side.id==="player"?"cpu":"player"]?"封印中：次ラウンド相手はサポート使用不可":`${window.BattleEngine.HAND_LABELS[sealer.condition?.hand]}で勝つと次ラウンド相手のサポートを封印`;
      const illusion=passive("nextRoundDieModifier");
      if(illusion) state=`${window.BattleEngine.HAND_LABELS[illusion.condition?.hand]}で勝つと次ラウンド自分のダイス+${illusion.value}`;
      const paladin=card.passives.find(item=>item.kind==="heal"&&item.condition?.condition==="rockPaperScissorsWin");
      if(paladin) state=`じゃんけん勝利で${paladin.value}回復`;
      const reviveTrigger=card.triggers.flatMap(trigger=>trigger.effects).find(effect=>effect.kind==="revive"&&effect.condition?.usesPerBattle);
      if(reviveTrigger) state=`蘇生：${side.revivalUsed?"使用済み":"使用可能"}（1プレイヤー1試合1回まで）`;
      const beast=card.passives.find(item=>item.kind==="damageBonus"&&typeof item.condition==="string"&&item.condition.startsWith("currentHpAtMost:"));
      if(beast) state=`現在HP${Math.round(unit.currentHp/unit.maxHp*100)}%（${conditionText(beast.condition)}） → ダメージ+${hpConditionMet(beast.condition,unit)?beast.value:0}`;
      const sword=passive("formationScaling");
      if(sword) state=`${side.battleCards.length}枚編成 → HP${unit.maxHp} / ダメージ+${unit.battleStartDamageBonus}`;
      const hunter=passive("damageBonusPerOpponentBattleCardRemaining");
      if(hunter) { const n=engine.livingCards(side.id==="player"?match.cpu:match.player).length; state=`相手残り${n}枚 → ダメージ+${hunter.value[n]||0}`; }
      if(passive("suppressRpsDieModifier")) state="アクティブ中：両者のじゃんけんダイス補正0";
      return `<div class="special-note">${state||"固有能力は有効"}</div>`;
    }
    if (card.triggers.length) return `<div class="special-note">特殊ダイス効果は適用。表示外の固有効果は未実装</div>`;
    return "";
  }
  function cardPanel(side, owner) {
    const active = side.activeCard;
    const card = active?.card;
    const hpPct = active ? Math.max(0, Math.min(100, active.currentHp / active.maxHp * 100)) : 0;
    const remaining = engine.livingCards(side).filter(unit => unit !== active);
    const koCards = engine.getReviveCandidates(match, side.id);
    const currentPanel = card ? `<article class="combatant-card inspect-active" role="button" tabindex="0" data-inspect-instance="${active.instanceId}" style="--attribute:var(--${card.attribute})" aria-label="${card.name}の詳細を表示">
      <div class="combatant-top"><span class="rarity ${card.rarity}">${window.CARD_RARITY_LABELS[card.rarity]}</span><span class="attribute-label">${window.CARD_ATTRIBUTE_LABELS[card.attribute]}</span><span class="active-chip">ACTIVE</span></div>
      <h3>${card.name}</h3><div class="hp-numbers"><span>HP</span><b>${active.currentHp}</b><i>/</i><span>${active.maxHp}</span></div><div class="hp-track"><span style="width:${hpPct}%"></span></div>
      <div class="battle-dice-label">タップしてカード詳細</div><div class="battle-dice">${card.dice.map((v,i)=>`<span><small>${i+1}</small><b>${v}</b></span>`).join("")}</div>${cardSpecialNote(card,side)}</article>`
      : `<div class="combatant-card empty"><div class="empty-symbol">×</div><h3>全カードKO</h3><p>このチームのバトルカードは残っていません。</p></div>`;
    const inspectRows = (items, kind) => items.length ? items.map(item => {
      const definition = byId.get(item.cardId || item.card?.id);
      const hp = kind === "grave" ? 0 : item.currentHp;
      const maxHp = item.maxHp || definition?.baseHp || 0;
      return `<li><button type="button" class="inspect-list-card" data-inspect-instance="${item.instanceId}" aria-label="${definition?.name||item.name}の詳細を表示"><span>${definition?.name||item.name}</span><small>${hp}/${maxHp} HP　詳細 ›</small></button></li>`;
    }).join("") : `<li class="empty-list">なし</li>`;
    const supportCountLabel = onlineBattleMode && owner === "cpu" ? "SUPPORT 非公開" : `${side.supportCards.length} SUPPORT`;
    const supportPanel = onlineBattleMode && owner === "cpu" ? "" : `<div class="support-count"><span>サポートカード</span><b>${side.supportCards.length}枚</b><small>1ラウンドに1枚使用できます</small></div>`;
    return `<section class="battle-side ${owner}"><div class="side-heading"><span class="side-kicker">${owner === "player" ? "YOUR SIDE" : "OPPONENT"}</span><h2>${owner === "player" ? "あなた" : (onlineBattleMode ? "相手" : "CPU")}</h2><span class="side-count">${side.battleCards.length} BATTLE · ${supportCountLabel}</span></div>${currentPanel}
      <div class="side-lists"><div><h4><button type="button" class="inspect-group" data-inspect-list="${side.id}-remaining">残りバトルカード <b>${remaining.length}枚</b></button></h4><ul>${inspectRows(remaining,"remaining") || `<li class="empty-list">なし</li>`}</ul></div><div><h4><button type="button" class="inspect-group" data-inspect-list="${side.id}-grave">墓地 <b>${koCards.length}枚</b></button></h4><ul>${inspectRows(koCards,"grave")}</ul></div></div>
      <div class="revival-status">復活：<b>${side.revivalUsed?"使用済み":"使用可能"}</b></div>${supportPanel}</section>`;
  }

  function runtimeCard(instanceId) {
    if (!match) return null;
    for (const side of [match.player, match.cpu]) {
      const unit = side.battleCards.find(item => item.instanceId === instanceId);
      if (unit) return { card: unit.card, unit, owner: side };
      const support = [...side.supportCards, ...side.usedSupportCards].find(item => item.instanceId === instanceId);
      if (support) return { card: byId.get(support.cardId), unit: null, owner: side };
    }
    return null;
  }
  function cardDetailHtml(card, unit = null) {
    const hand = window.BattleEngine.ATTRIBUTE_HAND[card.attribute];
    const specialty = card.attribute === "white" ? "すべての手" : window.BattleEngine.HAND_LABELS[hand];
    const triggers = card.triggers.length ? card.triggers.map(trigger => `<li><b>出目 ${trigger.die.join("・")}</b><span>${trigger.effects.map(effectText).join(" / ")}</span></li>`).join("") : `<li class="detail-empty">なし</li>`;
    const passives = card.passives.length ? card.passives.map(passive => {
      const text=passive.kind==="formationScaling"
        ? `編成枚数別：${Object.entries(passive.value).map(([count,values])=>`${count}枚 HP${values.hp} / ダメージ+${values.damageBonus}`).join(" · ")}`
        : effectText(passive);
      return `<li>${text}</li>`;
    }).join("") : `<li class="detail-empty">なし</li>`;
    const notes = card.unresolved?.length ? card.unresolved.map(item => `<li>${item.note}</li>`).join("") : "";
    return `<article class="card-detail attr-${card.attribute}">
      <div class="card-art-slot" aria-label="カード画像エリア"><span>骰戦記</span><small>カード画像エリア</small></div>
      <div class="card-detail-heading"><span class="rarity ${card.rarity}">${window.CARD_RARITY_LABELS[card.rarity]}</span><span class="detail-attribute">${window.CARD_ATTRIBUTE_LABELS[card.attribute]}属性</span><h2 id="cardInfoTitle">${card.name}</h2></div>
      <div class="detail-summary"><span>HP <b>${unit ? `${unit.currentHp} / ${unit.maxHp}` : card.baseHp}</b></span><span>得意な手 <b>${specialty}</b></span></div>
      <section class="detail-section"><h3>ダイス 1〜6 の効果</h3><div class="detail-dice">${card.dice.map((value,index)=>`<div><small>${index+1}</small><b>${value}</b></div>`).join("")}</div>${triggers === `<li class="detail-empty">なし</li>` ? "" : `<ul class="detail-list">${triggers}</ul>`}</section>
      <section class="detail-section"><h3>固有能力</h3><ul class="detail-list">${passives}${notes}</ul></section>
      <section class="detail-section"><h3>サポート能力</h3><ul class="detail-list">${(card.supportOverrides || card.support).length ? (card.supportOverrides || card.support).map(item=>`<li>${effectText(item)}</li>`).join("") : `<li class="detail-empty">なし</li>`}</ul></section>
      ${card.description ? `<p class="detail-description">${card.description}</p>` : ""}
    </article>`;
  }
  function openCardDetail(instanceId) {
    const found=runtimeCard(instanceId);
    if (!found) return false;
    $("#cardInfoContent").innerHTML=cardDetailHtml(found.card,found.unit);
    $("#cardInfoOverlay").hidden=false;
    document.body.classList.add("modal-open");
    $("#cardInfoClose").focus?.();
    return true;
  }
  function showCardDefinitionDetail(cardId) {
    const card = byId.get(cardId);
    if (!card) return false;
    $("#cardInfoContent").innerHTML = cardDetailHtml(card);
    $("#cardInfoOverlay").hidden = false;
    document.body.classList.add("modal-open");
    $("#cardInfoClose").focus?.();
    return true;
  }
  function openCardList(listKey) {
    if (!match) return;
    const [sideId,kind]=listKey.split("-");
    const side=match[sideId];
    if (!side) return;
    let cards;
    if(kind==="remaining") cards=engine.livingCards(side).filter(unit=>unit!==side.activeCard);
    else cards=engine.getReviveCandidates(match,sideId).map(entry=>({instanceId:entry.instanceId,cardId:entry.cardId,currentHp:0,maxHp:entry.maxHp}));
    const rows=cards.length?cards.map(item=>{const card=byId.get(item.cardId);return `<button type="button" class="inspect-modal-row" data-inspect-instance="${item.instanceId}"><span class="attr-mark attr-${card.attribute}"></span><b>${card.name}</b><small>${item.currentHp}/${item.maxHp} HP · 詳細 ›</small></button>`}).join(""):`<p class="detail-empty">カードはありません。</p>`;
    $("#cardInfoContent").innerHTML=`<section class="inspect-list-view"><h2 id="cardInfoTitle">${side.label}：${kind==="grave"?"墓地":"残りバトルカード"}</h2><div class="inspect-modal-list">${rows}</div></section>`;
    $("#cardInfoOverlay").hidden=false;
    document.body.classList.add("modal-open");
  }
  function closeCardInfo() { $("#cardInfoOverlay").hidden=true; document.body.classList.remove("modal-open"); }
  function resultLabel(result) { return result === "win" ? "じゃんけん勝利！" : result === "loss" ? "じゃんけん敗北" : "あいこ"; }
  function renderLatestResult() {
    if (onlineBattleMode && onlineBattleStatus.includes("確定済み") && match.status === "handChoice") return `<div class="round-reveal waiting"><span class="reveal-mark">✦</span><span>あなたの選択は確定しました</span><small>${onlineBattleStatus}</small></div>`;
    if (match.status === "supportSelection" || match.status === "handChoice") return `<div class="round-reveal waiting"><span class="reveal-mark">✦</span><span>${match.status === "supportSelection" ? "サポートを選ぶラウンドです" : "じゃんけんの手を選んでください"}</span><small>${onlineBattleMode ? onlineBattleStatus : "CPUの手は確定するまで表示されません"}</small></div>`;
    if (match.status === "diceChoice" && match.pendingRound) {
      const p=match.pendingRound;
      const won=p.rpsResult==="win", drew=p.rpsResult==="draw";
      const cpuDice=p.cpuData.rerolled?`${p.cpuData.initialRaw} → ${p.cpuData.rawDie}（${onlineBattleMode?"相手":"CPU"}振り直し）`:`${p.cpuData.rawDie}`;
      return `<div class="round-reveal ${won?"won":drew?"tied":"lost"}"><span class="reveal-round">ROUND ${match.round} — DICE</span><div class="hands-reveal"><span><small>あなた</small><b>${engine.HAND_LABELS[p.playerHand]}</b></span><i>VS</i><span><small>${onlineBattleMode?"相手":"CPU"}</small><b>${engine.HAND_LABELS[p.cpuHand]}</b></span></div><strong>${resultLabel(p.rpsResult)}</strong><p>生ダイス：あなた ${p.playerData.rawDie} / ${onlineBattleMode?"相手":"CPU"} ${cpuDice}</p></div>`;
    }
    const latest=match.lastResultEntry;
    if (!latest) return `<div class="round-reveal waiting"><span class="reveal-mark">✦</span><span>ラウンド開始</span><small>CPUの手は確定するまで公開されません</small></div>`;
    const won=latest.rpsResult==="win", drew=latest.rpsResult==="draw";
    return `<div class="round-reveal ${won?"won":drew?"tied":"lost"}"><span class="reveal-round">ROUND ${latest.round} RESULT</span><div class="hands-reveal"><span><small>あなた</small><b>${engine.HAND_LABELS[latest.playerHand]}</b></span><i>VS</i><span><small>${onlineBattleMode?"相手":"CPU"}</small><b>${engine.HAND_LABELS[latest.cpuHand]}</b></span></div><strong>${resultLabel(latest.rpsResult)}</strong><p>ログに計算過程を記録しました。</p></div>`;
  }

  function supportWarning(card) {
    const active=match.player.activeCard;
    if (active && active.currentHp===active.maxHp && card.support.some(item=>item.kind==="heal")) return `<span class="support-warning">HPは満タンです。この回復は無駄になります。</span>`;
    return "";
  }
  function renderSupportControls() {
    const cards=match.player.supportCards;
    const locked=match.supportLockNextRound.player;
    const html=cards.map(owned=>{
      const card=byId.get(owned.cardId); const rare=card.rarity!=="normal";
      const selected=owned.instanceId===selectedSupportId;
      return `<article class="support-pick ${selected?"selected":""}"><div class="support-pick-copy"><span class="rarity ${card.rarity}">${window.CARD_RARITY_LABELS[card.rarity]}</span><b>${card.name}</b><small>${supportText(card)}</small></div><div class="support-pick-actions"><button type="button" class="support-select" data-support-instance="${owned.instanceId}" ${locked?"disabled":""}>${selected?"選択中":"使用候補"}</button><button type="button" class="support-detail" data-inspect-instance="${owned.instanceId}">詳細</button></div></article>`;
    }).join("");
    $("#supportChoiceList").innerHTML=html||`<p class="log-empty">使用できるサポートカードがありません。</p>`;
    const selected=cards.find(item=>item.instanceId===selectedSupportId);
    const card=selected?byId.get(selected.cardId):null;
    $("#supportPreview").innerHTML=(card?`<strong>${card.name}の効果</strong><span>${supportText(card)}</span>${supportWarning(card)}`:"サポートを選ぶと効果が表示されます。")+(locked?`<span class="support-warning">封印術師の能力により、このラウンドはサポートを使用できません。</span>`:"");
    $("#useSupportButton").disabled=!card||locked||Boolean(onlineBattleMode&&onlineBattleStatus.includes("確定済み"));
    $("#skipSupportButton").disabled=Boolean(onlineBattleMode&&onlineBattleStatus.includes("確定済み"));
    $("#skipSupportButton").textContent=locked?"封印中：サポートを使わず進む":"サポートを使わない";
  }

  function renderReviveControls() {
    const options=match.pendingRevive?.candidates||[];
    const pct=match.pendingRevive?.hpPercent||50;
    $("#reviveInstruction").textContent=`選んだカードは最大HPの${pct}%（端数切り捨て）で元のバトル枠に戻ります。`;
    $("#reviveChoiceList").innerHTML=options.map(id=>{
      const card=match.player.battleCards.find(item=>item.instanceId===id);
      return card?`<button class="revive-pick" data-revive-instance="${id}" ${onlineBattleMode&&onlineBattleStatus.includes("確定済み")?"disabled":""}><b>${card.card.name}</b><span>HP ${Math.floor(card.maxHp*pct/100)} / ${card.maxHp}</span><small>元のバトル枠 ${card.slotIndex+1}</small></button>`:"";
    }).join("");
  }
  function renderBattle() {
    if (!match) return;
    $("#roundNumber").textContent = `ROUND ${match.round}`;
    $("#battleHeading").innerHTML = onlineBattleMode ? "ONLINE <em>バトル</em>" : "CPU <em>バトル</em>";
    $("#onlineBattleStatus").textContent = onlineBattleStatus;
    $("#battleBackButton").textContent = onlineBattleMode ? "ルームを退出" : "編成に戻る";
    $("#handChoiceHelp").textContent = onlineBattleMode ? "手とサポートを確定すると、両者の確定後に同時公開されます。" : "CPUの手は確定するまで表示されません。";
    $("#nextRoundButton").disabled = onlineBattleMode && (!onlineBattleStatus.includes("次のラウンド") || onlineBattleStatus.includes("準備完了"));
    $("#playerBattlePanel").innerHTML = cardPanel(match.player, "player");
    $("#cpuBattlePanel").innerHTML = cardPanel(match.cpu, "cpu");
    $("#roundReveal").innerHTML = renderLatestResult();
    const status=match.status;
    $("#supportControls").hidden=status!=="supportSelection";
    $("#handControls").hidden=status!=="handChoice";
    $("#diceControls").hidden=status!=="diceChoice";
    $("#reviveControls").hidden=status!=="reviveChoice";
    $("#nextRoundControls").hidden=status!=="roundResolved";
    document.querySelectorAll(".hand-button").forEach(button=>{button.disabled=status!=="handChoice" || Boolean(onlineBattleMode&&onlineBattleStatus.includes("確定済み"));});
    renderSupportControls();
    if(status==="diceChoice"&&match.pendingRound){
      const p=match.pendingRound;
      $("#diceChoiceSummary").textContent=`あなた ${p.playerData.rawDie} / ${onlineBattleMode?"相手":"CPU"} ${p.cpuData.rawDie}${p.cpuData.rerolled?`（${onlineBattleMode?"相手":"CPU"}振り直し後。生${p.cpuData.initialRaw}）`:""}${p.playerData.rerollAvailable?"":" — 振り直し権なし・自動確定中"}`;
      $("#rerollButton").hidden=!p.playerData.rerollAvailable;
      $("#keepDieButton").hidden=!p.playerData.rerollAvailable;
      $("#rerollButton").disabled=onlineBattleMode&&onlineBattleStatus.includes("確定済み");
      $("#keepDieButton").disabled=onlineBattleMode&&onlineBattleStatus.includes("確定済み");
      $("#keepDieButton").innerHTML=p.playerData.rerollAvailable?"この出目を使う <span>→</span>":"ダイス結果を確定 <span>→</span>";
    }
    if(status==="reviveChoice") renderReviveControls();
    $("#battleResult").hidden = match.status !== "finished";
    $("#battleControls").hidden = status === "finished";
    if (status === "finished") {
      $("#resultWord").textContent = match.outcome;
      $("#resultMessage").textContent = match.outcome === "WIN" ? `${onlineBattleMode?"相手":"CPU"}のバトルカードをすべて倒した。` : match.outcome === "LOSE" ? "あなたのバトルカードはすべてKOされた。" : "両チームが同時に全滅した。";
    }
    $("#battleLog").innerHTML = match.log.slice().reverse().map(entry => `<article class="log-entry"><header><b>ROUND ${entry.round}</b><span>${entry.type==="roundResult"?resultLabel(entry.entry.rpsResult):entry.type==="support"?"サポート":entry.type==="reroll"?"振り直し":entry.type==="dice"?"じゃんけん・ダイス":"ラウンド開始"}</span></header><div>${engine.formatLog(entry).map(line => `<p>${line}</p>`).join("")}</div></article>`).join("") || `<p class="log-empty">ラウンド結果はここに表示されます。</p>`;
  }
  function confirmSupport(instanceId) {
    if(!match||match.status!=="supportSelection")return;
    if(onlineBattleMode) { Promise.resolve(onlineBattleController?.submitSupport(instanceId)).catch(error=>notify(error.message||"オンライン操作に失敗しました")); return; }
    engine.finishSupportPhase(match,instanceId,{rng:Math.random});
    selectedSupportId=null; renderBattle(); $("#battleLog").scrollTop=0;
  }
  function playHand(hand) {
    if(!match||match.status!=="handChoice")return;
    if(onlineBattleMode) { Promise.resolve(onlineBattleController?.submitHand(hand, selectedSupportId)).catch(error=>notify(error.message||"オンライン操作に失敗しました")); return; }
    engine.startRpsAndRoll(match,hand); renderBattle(); $("#battleLog").scrollTop=0;
    if(!match.pendingRound.playerData.rerollAvailable) {
      const pendingMatch=match;
      setTimeout(()=>{
        if(match===pendingMatch&&match.status==="diceChoice"&&!match.pendingRound.playerData.rerollAvailable) {
          engine.decidePlayerReroll(match,false); renderBattle(); $("#battleLog").scrollTop=0;
        }
      },900);
    }
  }
  function chooseReroll(value) { if(!match||match.status!=="diceChoice")return; if(onlineBattleMode){Promise.resolve(onlineBattleController?.submitReroll(value)).catch(error=>notify(error.message||"オンライン操作に失敗しました"));return;} engine.decidePlayerReroll(match,value); renderBattle(); $("#battleLog").scrollTop=0; }
  function chooseRevive(instanceId) { if(!match||match.status!=="reviveChoice")return; if(onlineBattleMode){Promise.resolve(onlineBattleController?.submitRevive(instanceId)).catch(error=>notify(error.message||"オンライン操作に失敗しました"));return;} engine.completeReviveChoice(match,instanceId); renderBattle(); $("#battleLog").scrollTop=0; }
  function nextRound() {
    selectedSupportId=null;
    if(onlineBattleMode){Promise.resolve(onlineBattleController?.nextRound()).catch(error=>notify(error.message||"オンライン操作に失敗しました"));return;}
    if (engine.advanceRound(match)) renderBattle();
  }

  grid.addEventListener("click", event => {
    const detail = event.target.closest("[data-formation-detail]");
    if (detail) { showCardDefinitionDetail(detail.dataset.formationDetail); return; }
    const item = event.target.closest(".game-card");
    if (item) toggleSelection(item.dataset.instance);
  });
  grid.addEventListener("keydown", event => {
    const detail = event.target.closest("[data-formation-detail]");
    if (detail && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); showCardDefinitionDetail(detail.dataset.formationDetail); return; }
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest(".game-card");
    if (item) { event.preventDefault(); toggleSelection(item.dataset.instance); }
  });
  window.CPUFormationUI = {
    renderCard: renderFormationCard,
    showCardDetail: showCardDefinitionDetail,
    getBattleIds: cardIds => window.CPU_DECK.chooseBattleIds(cardIds, byId, MAX_BATTLE_CARDS)
  };
  window.CPUOnlineBattleUI = {
    start(onlineMatch, controller, status = "") {
      match = onlineMatch; onlineBattleMode = true; onlineBattleController = controller; onlineBattleStatus = status; selectedSupportId = null;
      $("#startView").hidden = true; $("#onlineView").hidden = true; $("#buildView").hidden = true; $("#completeView").hidden = true; $("#battleView").hidden = false;
      setPhase("PHASE 03", "オンラインバトル"); renderBattle(); window.scrollTo({top:0,behavior:"smooth"});
    },
    update(onlineMatch, status = "") { match = onlineMatch; onlineBattleMode = true; onlineBattleStatus = status; renderBattle(); },
    showStatus(status = "") { onlineBattleStatus = status; renderBattle(); },
    setSupport(instanceId = "") { selectedSupportId = instanceId || null; if (match) renderSupportControls(); },
    end() { onlineBattleMode = false; onlineBattleController = null; onlineBattleStatus = ""; match = null; $("#battleView").hidden = true; }
  };
  poolGrid.addEventListener("click",event=>{const item=event.target.closest("[data-pool-card]");if(item)togglePoolCard(item.dataset.poolCard);});
  poolGrid.addEventListener("keydown",event=>{if(event.key!=="Enter"&&event.key!==" ")return;const item=event.target.closest("[data-pool-card]");if(item){event.preventDefault();togglePoolCard(item.dataset.poolCard);}});
  document.querySelectorAll(".filter").forEach(button => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach(filter => filter.classList.toggle("active", filter === button));
    renderGrid();renderPoolGrid();
  }));
  $("#poolContinue").addEventListener("click",acceptPoolSelection);
  $("#quickStartButton").addEventListener("click",quickStart);
  $("#manualStartButton").addEventListener("click",startManualBuild);
  $("#randomPlayerDeckButton").addEventListener("click",generatePlayerDeck);
  $("#prepareBothRandomButton").addEventListener("click",prepareBothRandom);
  $("#autoFormationButton").addEventListener("click",autoOrganizePlayer);
  $("#poolRareShortcut").addEventListener("click",selectAllRarePool);
  $("#poolReset").addEventListener("click",()=>{poolSelectionIds=[];renderPoolGrid();});
  $("#poolEditButton").addEventListener("click",showPool);
  $("#startButton").addEventListener("click", showComplete);
  $("#backButton").addEventListener("click", () => { match = null; $("#completeView").hidden = true; $("#buildView").hidden = false; renderGrid(); updateCounts(); });
  $("#cpuStartButton").addEventListener("click", beginBattle);
  $("#generateCpuDeckButton").addEventListener("click", refreshCpuDeck);
  $("#battleBackButton").addEventListener("click", () => onlineBattleMode ? onlineBattleController?.exit() : showBuild(false));
  $("#nextRoundButton").addEventListener("click", nextRound);
  $("#againButton").addEventListener("click", () => showBuild(true));
  $("#randomPlayerAgainButton").addEventListener("click",rematchRandomBoth);
  $("#sameCpuAgainButton").addEventListener("click", rematchSameCpu);
  $("#newCpuAgainButton").addEventListener("click", rematchNewCpu);
  document.querySelectorAll(".hand-button").forEach(button => button.addEventListener("click", () => playHand(button.dataset.hand)));
  $("#supportChoiceList").addEventListener("click",event=>{
    const detail=event.target.closest(".support-detail");
    if(detail){openCardDetail(detail.dataset.inspectInstance);return;}
    const button=event.target.closest(".support-select");
    if(button&&!button.disabled){selectedSupportId=button.dataset.supportInstance;renderSupportControls();}
  });
  for(const panel of [$("#playerBattlePanel"),$("#cpuBattlePanel")]) panel.addEventListener("click",event=>{
    const list=event.target.closest("[data-inspect-list]");
    const card=event.target.closest("[data-inspect-instance]");
    if(list)openCardList(list.dataset.inspectList);else if(card)openCardDetail(card.dataset.inspectInstance);
  });
  $("#cardInfoContent").addEventListener("click",event=>{const card=event.target.closest("[data-inspect-instance]");if(card)openCardDetail(card.dataset.inspectInstance);});
  $("#cardInfoClose").addEventListener("click",closeCardInfo);
  $("#cardInfoCloseTop").addEventListener("click",closeCardInfo);
  $("#cardInfoOverlay").addEventListener("click",event=>{if(event.target===event.currentTarget)closeCardInfo();});
  $("#battleView").addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches?.("[data-inspect-instance]")){event.preventDefault();openCardDetail(event.target.dataset.inspectInstance);}});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!$("#cardInfoOverlay").hidden)closeCardInfo();});
  $("#useSupportButton").addEventListener("click",()=>confirmSupport(selectedSupportId));
  $("#skipSupportButton").addEventListener("click",()=>confirmSupport(null));
  $("#rerollButton").addEventListener("click",()=>chooseReroll(true));
  $("#keepDieButton").addEventListener("click",()=>chooseReroll(false));
  $("#reviveChoiceList").addEventListener("click",event=>{const button=event.target.closest(".revive-pick");if(button)chooseRevive(button.dataset.reviveInstance);});

  renderGrid(); updateCounts(); renderPoolGrid(); refreshCpuDeck();
  window.__gameForTesting = { get playerOwned(){return playerOwned;},get cpuOwned(){return cpuOwned;},get cpuBattleIds(){return [...cpuBattleIds];},get cpuRareCount(){return cpuRoster.rareCount;},selectedOrder,toggleSelection,showComplete,beginBattle,refreshCpuDeck,rematchSameCpu,rematchNewCpu,rematchRandomBoth,quickStart,startManualBuild,generatePlayerDeck,autoOrganizePlayer,prepareBothRandom,getMatch:()=>match,confirmSupport,playHand,chooseReroll,chooseRevive,nextRound,showHome,showBuild,showPool,togglePoolCard,acceptPoolSelection,selectAllRarePool,getPoolSelection:()=>[...poolSelectionIds],getCardAbilityText:cardId=>abilityLines(byId.get(cardId)),getCardDetailHtml:cardId=>cardDetailHtml(byId.get(cardId)),renderBattle };
})();
