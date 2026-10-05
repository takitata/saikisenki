import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, set, update, get, remove, onValue, off, runTransaction,
  onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

(() => {
  const firebaseConfig = {
    apiKey: "AIzaSyDL1rQGAE5iDe_kJ8vIC0nntq4GjasxFVw",
    authDomain: "saikisenki-online.firebaseapp.com",
    projectId: "saikisenki-online",
    storageBucket: "saikisenki-online.firebasestorage.app",
    messagingSenderId: "743069964998",
    appId: "1:743069964998:web:ef1c777de5859f75e295c7",
    databaseURL: "https://saikisenki-online-default-rtdb.asia-southeast1.firebasedatabase.app"
  };
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getDatabase(app);
  const $ = id => document.getElementById(id);
  const els = {
    mode: $("onlineModeButton"), view: $("onlineView"), back: $("onlineBackButton"),
    create: $("createRoomButton"), join: $("joinRoomButton"), input: $("roomIdInput"),
    connection: $("onlineConnectionStatus"), dot: $("onlineConnectionDot"), auth: $("onlineAuthStatus"),
    actions: $("onlineLobbyActions"), roomPanel: $("onlineRoomPanel"), roomId: $("onlineRoomId"),
    roomMessage: $("onlineRoomMessage"), opponent: $("onlineOpponentStatus"), error: $("onlineError"),
    formation: $("onlineFormationPanel"), cards: $("onlineCardGrid"), rareCount: $("onlineRareCount"),
    battleCount: $("onlineBattleCount"), supportCount: $("onlineSupportCount"), ready: $("onlineReadyButton"),
    readyStatus: $("onlineReadyStatus"), formationError: $("onlineFormationError")
  };
  els.exitRoom = $("exitRoomButton");
  els.newRoom = $("newRoomButton");
  let currentRoom = null;
  let roomUnsubscribe = null;
  let connectionUnsubscribe = null;
  let presenceRef = null;
  let registeredDisconnect = null;
  let firebaseConnected = false;
  let statusWriteRequested = false;
  let dealUnsubscribe = null;
  let formationUnsubscribe = null;
  let formationRoomKey = "";
  let dealCreationRequested = false;
  let onlineDeal = null;
  let onlineFormation = null;
  let onlineBattleIds = [];
  let handlingOpponentExit = false;
  let onlineBattleMatch = null;
  let onlineBattleController = null;
  let actionSubmittingRound = null;
  let currentRoomState = null;
  const core = window.OnlineBattleCore;
  const gameEngine = window.BattleEngine;
  const cardMap = new Map(window.CARD_DATA.map(card => [card.id, card]));

  function errorText(error) {
    const code = error?.code || "";
    if (code.toLowerCase().includes("permission") || String(error?.message || "").toLowerCase().includes("permission denied")) return "FirebaseのSecurity Rules未設定、存在しないID、または満員のルームです。設定とルームIDを確認してください。";
    if (code.includes("network")) return "ネットワークに接続できません。通信状態を確認してください。";
    if (code.includes("auth/operation-not-allowed")) return "Firebase Consoleで匿名認証を有効にしてください。";
    return error?.message || "オンライン接続に失敗しました。Firebase設定を確認してください。";
  }
  function showError(message = "") { els.error.textContent = message; }
  function setBusy(busy) {
    els.create.disabled = busy;
    els.join.disabled = busy;
    els.input.disabled = busy;
  }
  async function ensureUser() {
    if (auth.currentUser) return auth.currentUser;
    els.auth.textContent = "匿名認証中…";
    const credential = await signInAnonymously(auth);
    els.auth.textContent = "匿名認証済み";
    return credential.user;
  }
  function roomPath(roomId) { return `rooms/${roomId}`; }
  function saveLocalRoom(roomId, role, uid) {
    try { sessionStorage.setItem("saikisenki-online-room", JSON.stringify({ roomId, role, uid })); } catch {}
  }
  function loadLocalRoom() {
    try { return JSON.parse(sessionStorage.getItem("saikisenki-online-room") || "null"); } catch { return null; }
  }
  function setPaired(paired, room) {
    els.view.classList.toggle("is-matched", paired);
    document.querySelector(".online-panel")?.classList.toggle("is-matched", paired);
    els.roomPanel.hidden = false;
    els.actions.hidden = true;
    els.roomId.textContent = currentRoom.roomId;
    els.roomMessage.textContent = paired ? "接続しました" : "対戦相手を待っています";
    const otherRole = currentRoom.role === "host" ? "guest" : "host";
    const otherConnected = room.presence?.[otherRole]?.connected === true;
    els.opponent.innerHTML = paired
      ? (otherConnected
        ? '<i class="live-dot"></i>対戦相手が参加しました'
        : '<i class="waiting-dot"></i>対戦相手が切断中です…')
      : '<i class="waiting-dot"></i>対戦相手を待っています';
    els.newRoom.hidden = !(currentRoom.role === "host" && !paired && room.status === "waiting");
    if (paired && currentRoom.role === "host" && room.status === "waiting" && !statusWriteRequested) {
      statusWriteRequested = true;
      set(ref(db, `${roomPath(currentRoom.roomId)}/status`), "paired").catch(error => { statusWriteRequested = false; showError(errorText(error)); });
    }
    if (paired) startOnlineFormation(room);
  }
  function privatePath(roomId, uid) { return `privateRoomData/${roomId}/${uid}`; }
  function battlePath(roomId) { return `${roomPath(roomId)}/match`; }
  function roundPath(roomId, round) { return `${battlePath(roomId)}/rounds/${round}`; }
  function activeOnlineRound() { return Number(battleStateCache.currentRound || core.nextRoundNumber(battleStateCache) || 1); }
  function roleUid(room, role) { return role === "host" ? room.hostUid : room.players?.guest?.uid; }
  function otherRole(role) { return role === "host" ? "guest" : "host"; }
  function secretKey(roomId, round) { return `saikisenki-online-round-secret:${roomId}:${round}`; }
  function readSecret(roomId, round) { try { return JSON.parse(sessionStorage.getItem(secretKey(roomId, round)) || "null"); } catch { return null; } }
  function writeSecret(roomId, round, secret) { try { sessionStorage.setItem(secretKey(roomId, round), JSON.stringify(secret)); return true; } catch { return false; } }
  function setBattleError(message) { showError(message); }
  function setBattleStatus(message, match = onlineBattleMatch, start = false) {
    onlineBattleMatch = match;
    if (!window.CPUOnlineBattleUI || !match) return;
    const opponent = currentRoom && currentRoomState?.presence?.[otherRole(currentRoom.role)];
    const connectionMessage = opponent && opponent.connected === false ? " · 対戦相手が切断中です…再接続を待っています" : "";
    const controller = onlineBattleController || { exit: exitRoom };
    if (start) window.CPUOnlineBattleUI.start(match, controller, `${message}${connectionMessage}`);
    else window.CPUOnlineBattleUI.update(match, `${message}${connectionMessage}`);
  }
  async function ensureOwnTeamManifest(room) {
    if (!currentRoom || !onlineDeal || !onlineFormation?.ready) return;
    const teamRef = ref(db, `${battlePath(currentRoom.roomId)}/teams/${currentRoom.role}`);
    const battle = onlineFormation.battleInstanceIds.map(instanceId => {
      const owned = onlineDeal.cards.find(item => item.instanceId === instanceId);
      return owned ? { instanceId: owned.instanceId, definitionId: owned.definitionId } : null;
    }).filter(Boolean);
    if (!battle.length) return;
    const manifest = { battle, lockedAt: onlineFormation.readyAt };
    try {
      await runTransaction(teamRef, current => current == null ? manifest : undefined, { applyLocally: false });
    } catch (error) { setBattleError(errorText(error)); }
  }
  async function ensureRoundCounter(room) {
    if (room.match?.currentRound) return;
    const counterRef = ref(db, `${battlePath(currentRoom.roomId)}/currentRound`);
    await runTransaction(counterRef, current => current == null && room.match?.teams?.host && room.match?.teams?.guest ? "1" : undefined, { applyLocally: false });
  }
  async function advanceSharedRound(room, roundNumber) {
    const roundData = room.match?.rounds?.[String(roundNumber)];
    if (!core.isSettledRound(roundData) || !roundData?.nextReady?.host || !roundData?.nextReady?.guest) return false;
    const counterRef = ref(db, `${battlePath(currentRoom.roomId)}/currentRound`);
    const result = await runTransaction(counterRef, current => current === String(roundNumber) ? String(roundNumber + 1) : undefined, { applyLocally: false });
    return result.committed;
  }
  function revivePair(roundData, role) { return { player: roundData?.revives?.[role] || null, cpu: roundData?.revives?.[otherRole(role)] || null }; }
  function ownedForDeal(deal) { return (deal?.cards || []).map(item => ({ instanceId: item.instanceId, definitionId: item.definitionId })); }
  function buildBattleBase(room) {
    const role = currentRoom.role;
    const ownFormation = onlineFormation;
    const ownDeal = onlineDeal;
    const opponent = room.match?.teams?.[otherRole(role)];
    if (!ownDeal || !ownFormation?.ready || !opponent?.battle?.length) return null;
    return core.makeMatch(gameEngine, {
      ownOwned: ownedForDeal(ownDeal),
      ownBattleIds: ownFormation.battleInstanceIds,
      opponentBattle: opponent.battle,
      cardMap,
      localRole: role
    });
  }
  function pendingStatus(room, roundData, match) {
    const role = currentRoom.role;
    const other = otherRole(role);
    if (!roundData?.actionCommits?.[role]) return "あなたの選択を待っています";
    if (!roundData?.actionCommits?.[other]) return "あなた：確定済み · 相手の選択を待っています";
    if (!roundData?.actionReveals?.[role] || !roundData?.actionReveals?.[other]) return "選択を公開・検証しています…";
    if (match?.status === "diceChoice") {
      if (!match.pendingRound?.playerData?.rerollAvailable) return "あなた：振り直し権なし · 相手の処理を待っています";
      if (roundData?.rerolls?.[role] === undefined) return "生ダイス公開済み · リロールを選択してください";
      if (roundData?.rerolls?.[other] === undefined) return "あなた：リロール確定済み · 相手の選択を待っています";
    }
    if (match?.status === "reviveChoice") {
      const required = match.pendingRevives?.some(item => item.sideId === "player");
      if (required && !roundData?.revives?.[role]) return "復活するカードを選択してください";
      const opponentRequired = match.pendingRevives?.some(item => item.sideId === "cpu");
      if (opponentRequired && !roundData?.revives?.[other]) return "あなた：復活選択済み · 相手の選択を待っています";
      if (required) return "あなた：復活選択済み · 結果を確認中…";
    }
    if (match?.status === "roundResolved" && !core.isSettledRound(roundData)) return "結果を確認中…";
    if (core.isSettledRound(roundData)) return match?.status === "finished" ? "対戦終了 · ラウンド結果確定" : roundData.nextReady?.[role] ? "あなた：次のラウンドへ進む準備完了 · 相手を待っています" : `ROUND ${match?.round} 確定 · 次のラウンドへ進めます`;
    return "相手の選択を待っています";
  }
  async function replayBattle(room) {
    if (!currentRoom || !onlineDeal || !onlineFormation?.ready || !room.match?.teams?.host || !room.match?.teams?.guest) return;
    const role = currentRoom.role;
    let match = buildBattleBase(room);
    if (!match) return;
    const rounds = room.match.rounds || {};
    let roundNo = 1;
    while (core.isSettledRound(rounds[String(roundNo)])) {
      const saved = rounds[String(roundNo)];
      const host = saved.actionReveals?.host;
      const guest = saved.actionReveals?.guest;
      if (!host || !guest || saved.rerolls?.host === undefined || saved.rerolls?.guest === undefined) throw new Error(`ROUND ${roundNo} の確定データが不足しています。`);
      if (!(await core.verifyReveal(roundNo, "host", host, saved.actionCommits?.host)) || !(await core.verifyReveal(roundNo, "guest", guest, saved.actionCommits?.guest))) throw new Error(`ROUND ${roundNo} のcommit-reveal検証に失敗しました。`);
      const dice = await core.deriveDice(currentRoom.roomId, roundNo, host.seed, guest.seed);
      const ownChoice = role === "host" ? host : guest;
      const opponentChoice = role === "host" ? guest : host;
      const current = core.resolveRevealedRound(gameEngine, match, ownChoice, opponentChoice,
        Boolean(saved.rerolls[role]), Boolean(saved.rerolls[otherRole(role)]), dice[role], dice[otherRole(role)], revivePair(saved, role));
      if (current.status === "reviveChoice") throw new Error(`ROUND ${roundNo} の復活選択が確定していません。`);
      const actualHash = await core.hashSnapshot(core.snapshot(current, role));
      if (actualHash !== saved.resultClaims.host.hash || actualHash !== saved.resultClaims.guest.hash) throw new Error(`ROUND ${roundNo} の結果ハッシュが一致しません。`);
      if (saved.nextReady?.host && saved.nextReady?.guest) { gameEngine.advanceRound(match); roundNo++; }
      else break;
    }
    const activeRound = String(roundNo);
    const saved = rounds[activeRound] || {};
    if (!core.isSettledRound(saved) && saved.actionReveals?.host && saved.actionReveals?.guest) {
      const host = saved.actionReveals.host, guest = saved.actionReveals.guest;
      if (!(await core.verifyReveal(roundNo, "host", host, saved.actionCommits?.host)) || !(await core.verifyReveal(roundNo, "guest", guest, saved.actionCommits?.guest))) throw new Error(`ROUND ${roundNo} のcommit-reveal検証に失敗しました。`);
      const dice = await core.deriveDice(currentRoom.roomId, roundNo, host.seed, guest.seed);
      const ownChoice = role === "host" ? host : guest;
      const opponentChoice = role === "host" ? guest : host;
      core.beginRevealedRound(gameEngine, match, ownChoice, opponentChoice, dice[role], dice[otherRole(role)]);
      if (saved.rerolls?.host !== undefined && saved.rerolls?.guest !== undefined) {
        match = core.finishRevealedRound(gameEngine, match,
          Boolean(saved.rerolls[role]), Boolean(saved.rerolls[otherRole(role)]), dice[role], dice[otherRole(role)], revivePair(saved, role));
        if (match.status === "reviveChoice") {
          const choices = revivePair(saved, role);
          if (match.pendingRevives?.every(item => choices[item.sideId])) gameEngine.completeOnlineRevives(match, choices);
        }
        if (match.status === "roundResolved") {
          const resultHash = await core.hashSnapshot(core.snapshot(match, role));
          if (!saved.resultClaims?.[role]) await writeOnce(`${roundPath(currentRoom.roomId, roundNo)}/resultClaims/${role}`, { hash: resultHash });
          if (core.isSettledRound(saved) && (saved.resultClaims.host.hash !== resultHash || saved.resultClaims.guest.hash !== resultHash)) throw new Error(`ROUND ${roundNo} の結果ハッシュが一致しません。`);
        }
      }
    }
    onlineBattleMatch = match;
    if (!onlineBattleController) onlineBattleController = makeBattleController();
    const status = pendingStatus(room, saved, match);
    let localDraft = {}; try { localDraft = JSON.parse(sessionStorage.getItem(`${secretKey(currentRoom.roomId, roundNo)}:draft`) || "{}"); } catch {}
    if (match.status === "supportSelection" && (saved.actionCommits?.[role] || localDraft.supportId !== undefined)) match.status = "handChoice";
    if (!document.querySelector("#battleView")?.hidden) setBattleStatus(status, match);
    else setBattleStatus(status, match, true);
    window.CPUOnlineBattleUI?.setSupport(localDraft.supportId || "");
    if (match.status === "diceChoice" && !match.pendingRound.playerData.rerollAvailable && saved.rerolls?.[role] === undefined) {
      await writeOnce(`${roundPath(currentRoom.roomId, roundNo)}/rerolls/${role}`, false);
    }
  }
  async function writeOnce(path, value) {
    const result = await runTransaction(ref(db, path), current => current == null ? value : undefined, { applyLocally: false });
    if (!result.committed) {
      const existing = await get(ref(db, path));
      if (!existing.exists()) throw new Error("オンライン操作を保存できませんでした。");
    }
  }
  function makeBattleController() {
    return {
      submitSupport(instanceId) {
        if (!currentRoom || !onlineBattleMatch || onlineBattleMatch.status !== "supportSelection") return;
        const key = secretKey(currentRoom.roomId, activeOnlineRound());
        const draft = { supportId: instanceId || "" };
        try { sessionStorage.setItem(`${key}:draft`, JSON.stringify(draft)); } catch {}
        window.CPUOnlineBattleUI?.setSupport(draft.supportId);
        onlineBattleMatch.status = "handChoice";
        setBattleStatus("サポートを確定しました。じゃんけんの手を選んでください", onlineBattleMatch);
      },
      async submitHand(hand) {
        if (!currentRoom || !onlineBattleMatch || onlineBattleMatch.status !== "handChoice") return;
        const round = activeOnlineRound();
        if (actionSubmittingRound === round) return;
        actionSubmittingRound = round;
        const draftKey = `${secretKey(currentRoom.roomId, round)}:draft`;
        let draft = {}; try { draft = JSON.parse(sessionStorage.getItem(draftKey) || "{}"); } catch {}
        const owned = onlineDeal?.cards.find(item => item.instanceId === draft.supportId);
        const choice = { hand, supportId: owned?.instanceId || "", supportDefinitionId: owned?.definitionId || "", seed: core.randomHex(), nonce: core.randomHex() };
        try {
          if (!writeSecret(currentRoom.roomId, round, choice)) throw new Error("このブラウザで選択を一時保存できませんでした。ブラウザのストレージ設定を確認してください。");
          const commitment = await core.createCommitment(round, currentRoom.role, choice);
          await writeOnce(`${roundPath(currentRoom.roomId, round)}/actionCommits/${currentRoom.role}`, commitment);
          onlineBattleMatch.status = "handChoice";
          setBattleStatus("あなた：確定済み · 相手の選択を待っています", onlineBattleMatch);
        } catch (error) { actionSubmittingRound = null; throw error; }
      },
      async submitReroll(value) {
        const round = activeOnlineRound();
        await writeOnce(`${roundPath(currentRoom.roomId, round)}/rerolls/${currentRoom.role}`, Boolean(value));
      },
      async submitRevive(instanceId) {
        const round = activeOnlineRound();
        await writeOnce(`${roundPath(currentRoom.roomId, round)}/revives/${currentRoom.role}`, instanceId);
      },
      async nextRound() {
        if (!currentRoom) return;
        const round = activeOnlineRound();
        await writeOnce(`${roundPath(currentRoom.roomId, round)}/nextReady/${currentRoom.role}`, true);
      },
      exit: exitRoom
    };
  }
  let battleStateCache = {};
  async function handleBattleRoom(room) {
    currentRoomState = room;
    if (!currentRoom || !room.players?.host?.ready || !room.players?.guest?.ready || !onlineFormation?.ready || !onlineDeal) return;
    await ensureOwnTeamManifest(room);
    if (!room.match?.teams?.host || !room.match?.teams?.guest) return;
    await ensureRoundCounter(room);
    const current = Number(room.match.currentRound || 1);
    if (await advanceSharedRound(room, current)) return;
    battleStateCache = room.match;
    const roundNumber = current;
    const round = room.match.rounds?.[String(roundNumber)] || {};
    const role = currentRoom.role;
    if (round.actionCommits?.host && round.actionCommits?.guest && !round.actionReveals?.[role]) {
      const secret = readSecret(currentRoom.roomId, roundNumber);
      if (!secret) throw new Error("確定した手のローカル復元データがありません。端末のセッションを維持して再接続してください。");
      await writeOnce(`${roundPath(currentRoom.roomId, roundNumber)}/actionReveals/${role}`, secret);
    }
    if (round.actionReveals?.host && round.actionReveals?.guest) {
      if (!(await core.verifyReveal(roundNumber, "host", round.actionReveals.host, round.actionCommits?.host)) || !(await core.verifyReveal(roundNumber, "guest", round.actionReveals.guest, round.actionCommits?.guest))) throw new Error("じゃんけん・サポートのcommit-revealが一致しません。ラウンドを停止しました。");
    }
    if (round.resultClaims?.host?.hash && round.resultClaims?.guest?.hash && round.resultClaims.host.hash !== round.resultClaims.guest.hash) throw new Error("両端末で計算したラウンド結果が一致しません。同期を停止しました。");
    await replayBattle(room);
  }
  function renderOnlineFormation(room) {
    if (!onlineDeal) return;
    const selected = new Set(onlineBattleIds);
    const locked = Boolean(onlineFormation?.ready);
    els.formation.hidden = false;
    els.rareCount.textContent = String(onlineDeal.rareCount);
    els.battleCount.textContent = String(selected.size);
    els.supportCount.textContent = String(Math.max(0, onlineDeal.cards.length - selected.size));
    els.ready.disabled = locked || selected.size < 1 || selected.size > 5;
    $("onlineAutoFormationButton").disabled = locked;
    els.ready.textContent = locked ? "準備完了" : "編成完了";
    els.cards.innerHTML = onlineDeal.cards.map(owned => window.CPUFormationUI.renderCard(
      { instanceId: owned.instanceId, cardId: owned.definitionId }, onlineBattleIds, { locked, showRole: true }
    )).join("");
    const meReady = Boolean(room.players?.[currentRoom.role]?.ready);
    const otherRole = currentRoom.role === "host" ? "guest" : "host";
    const otherReady = Boolean(room.players?.[otherRole]?.ready);
    els.readyStatus.innerHTML = `<p class="${meReady ? "is-ready" : ""}">あなた：${meReady ? "準備完了" : "編成中…"}</p><p class="${otherReady ? "is-ready" : ""}">相手：${otherReady ? "準備完了" : "編成中…"}</p>${meReady && otherReady ? "<p class=\"is-ready\">両者の編成が完了しました — 対戦準備完了</p>" : ""}`;
    els.formationError.textContent = "";
  }
  function startOnlineFormation(room) {
    const user = auth.currentUser;
    if (!user || !currentRoom) return;
    const roomKey = `${currentRoom.roomId}:${user.uid}`;
    if (formationRoomKey === roomKey) {
      renderOnlineFormation(room);
      return;
    }
    if (dealUnsubscribe) dealUnsubscribe();
    if (formationUnsubscribe) formationUnsubscribe();
    formationRoomKey = roomKey;
    dealCreationRequested = false;
    onlineDeal = null;
    onlineFormation = null;
    onlineBattleIds = [];
    els.formation.hidden = false;
    els.cards.innerHTML = "<p class=\"online-copy\">カードを準備しています…</p>";
    const path = privatePath(currentRoom.roomId, user.uid);
    const dealRef = ref(db, `${path}/deal`);
    const dealHandler = onValue(dealRef, snapshot => {
      if (snapshot.exists()) {
        onlineDeal = snapshot.val();
        if (onlineFormation?.ready) onlineBattleIds = [...onlineFormation.battleInstanceIds];
        renderOnlineFormation(room);
        get(ref(db, roomPath(currentRoom.roomId))).then(value => handleBattleRoom(value.val() || {})).catch(error => setBattleError(error.message || errorText(error)));
        return;
      }
      if (dealCreationRequested) return;
      dealCreationRequested = true;
      const generatedDeal = window.OnlineRoomSchema.createOnlineDeal(user.uid, window.CARD_DATA);
      runTransaction(dealRef, current => current == null ? generatedDeal : undefined, { applyLocally: false })
        .then(async result => {
          if (!result.committed) {
            const stored = await get(dealRef);
            if (stored.exists()) { onlineDeal = stored.val(); renderOnlineFormation(room); get(ref(db, roomPath(currentRoom.roomId))).then(value => handleBattleRoom(value.val() || {})).catch(error => setBattleError(error.message || errorText(error))); }
            else showError("配布カードを確定できませんでした。再読み込みして復元を試してください。");
          }
        })
        .catch(error => { dealCreationRequested = false; showError(errorText(error)); });
    }, error => showError(errorText(error)));
    dealUnsubscribe = () => off(dealRef, "value", dealHandler);
    const formationRef = ref(db, `${path}/formation`);
    const formationHandler = onValue(formationRef, snapshot => {
      onlineFormation = snapshot.exists() ? snapshot.val() : null;
      if (onlineFormation?.ready) onlineBattleIds = [...onlineFormation.battleInstanceIds];
      renderOnlineFormation(room);
      get(ref(db, roomPath(currentRoom.roomId))).then(value => handleBattleRoom(value.val() || {})).catch(error => setBattleError(error.message || errorText(error)));
    }, error => showError(errorText(error)));
    formationUnsubscribe = () => off(formationRef, "value", formationHandler);
  }
  async function syncPresence() {
    if (!firebaseConnected || !presenceRef) return;
    try {
      registeredDisconnect = onDisconnect(presenceRef);
      await registeredDisconnect.set({ connected: false, changedAt: serverTimestamp() });
      await set(presenceRef, { connected: true, changedAt: serverTimestamp() });
    } catch (error) { showError(errorText(error)); }
  }
  function watchConnection() {
    if (connectionUnsubscribe) connectionUnsubscribe();
    const connected = ref(db, ".info/connected");
    const connectionHandler = snapshot => {
      firebaseConnected = snapshot.val() === true;
      els.dot.classList.toggle("is-connected", firebaseConnected);
      els.connection.textContent = firebaseConnected ? "Firebase接続中" : "Firebase未接続";
      if (firebaseConnected) syncPresence();
    };
    onValue(connected, connectionHandler, error => showError(errorText(error)));
    connectionUnsubscribe = () => off(connected, "value", connectionHandler);
  }
  function listenRoom(roomId, role) {
    if (roomUnsubscribe) roomUnsubscribe();
    currentRoom = { roomId, role };
    statusWriteRequested = false;
    els.roomId.textContent = roomId;
    els.roomPanel.hidden = false;
    els.actions.hidden = true;
    els.roomMessage.textContent = "対戦相手を待っています";
    const root = ref(db, roomPath(roomId));
    const roomHandler = onValue(root, snapshot => {
      if (!snapshot.exists()) {
        showError("このルームは終了したか、存在しません。");
        return;
      }
      const room = snapshot.val();
      if (room.exit) {
        if (room.exit.uid !== auth.currentUser?.uid) handleOpponentExit();
        return;
      }
      const guestUid = room.players?.guest?.uid;
      const paired = room.status === "paired" || Boolean(guestUid);
      setPaired(paired, room);
      handleBattleRoom(room).catch(error => setBattleError(error.message || errorText(error)));
    }, error => showError(errorText(error)));
    roomUnsubscribe = () => off(root, "value", roomHandler);

    const presenceRole = role === "host" ? "host" : "guest";
    presenceRef = ref(db, `${roomPath(roomId)}/presence/${presenceRole}`);
    syncPresence();
  }
  async function enterOnline() {
    if (!els.view.hidden) return;
    showError();
    $("startView").hidden = true;
    els.view.hidden = false;
    watchConnection();
    els.auth.textContent = "匿名認証中…";
    try {
      const user = await ensureUser();
      els.auth.textContent = `匿名認証済み · ${user.uid.slice(0, 6)}`;
      const saved = loadLocalRoom();
      if (saved?.uid === user.uid && /^\d{6}$/.test(saved.roomId) && ["host", "guest"].includes(saved.role)) {
        listenRoom(saved.roomId, saved.role);
      }
    } catch (error) {
      showError(errorText(error));
      els.auth.textContent = "匿名認証に失敗しました";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function createRoom() {
    showError(); setBusy(true);
    try {
      const user = await ensureUser();
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      const roomId = String(100000 + (random[0] % 900000));
      const createdAt = serverTimestamp();
      const room = window.OnlineRoomSchema.createRoomSeed(user.uid, createdAt);
      room.presence.host = { connected: true, changedAt: createdAt };
      try {
        await set(ref(db, roomPath(roomId)), room);
        saveLocalRoom(roomId, "host", user.uid);
        listenRoom(roomId, "host");
      } catch (error) {
        if (error?.code === "PERMISSION_DENIED" || String(error?.message).toLowerCase().includes("permission")) {
          throw new Error("Realtime Databaseがルーム作成を拒否しました。最新の online-database.rules.json を公開済みか確認してください。まれなID重複の場合は、もう一度作成してください。");
        }
        throw error;
      }
    } catch (error) { showError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function joinRoom() {
    showError();
    const roomId = els.input.value.trim();
    if (!/^\d{6}$/.test(roomId)) { showError("6桁のルームIDを入力してください。"); els.input.focus(); return; }
    setBusy(true);
    try {
      const user = await ensureUser();
      const guestBase = `${roomPath(roomId)}/players/guest`;
      const guestRef = ref(db, guestBase);
      // Claim and bind the uid in one transaction. A transient null is handled;
      // RTDB reruns the updater with its authoritative value before committing.
      const claim = await runTransaction(guestRef, current => window.OnlineRoomSchema.claimGuestSlot(current, user.uid), { applyLocally: false });
      if (!claim.committed) throw new Error("このルームは満員か、参加できる状態ではありません。");
      saveLocalRoom(roomId, "guest", user.uid);
      listenRoom(roomId, "guest");
    } catch (error) {
      const message = error?.message?.includes("満員") ? error.message : errorText(error);
      showError(message);
    } finally { setBusy(false); }
  }
  async function stopPresence() {
    let markedOffline = false;
    if (presenceRef) {
      try {
        await set(presenceRef, { connected: false, changedAt: serverTimestamp() });
        markedOffline = true;
      } catch (error) { showError(errorText(error)); }
    }
    if (markedOffline && registeredDisconnect) {
      try { await registeredDisconnect.cancel(); } catch (error) { showError(errorText(error)); }
    }
    registeredDisconnect = null;
  }
  function stopRoomListeners() {
    if (roomUnsubscribe) roomUnsubscribe();
    if (dealUnsubscribe) dealUnsubscribe();
    if (formationUnsubscribe) formationUnsubscribe();
    roomUnsubscribe = null; dealUnsubscribe = null; formationUnsubscribe = null; formationRoomKey = "";
    presenceRef = null; currentRoom = null; currentRoomState = null; onlineDeal = null; onlineFormation = null; onlineBattleIds = []; onlineBattleMatch = null; battleStateCache = {}; actionSubmittingRound = null;
  }
  function stopConnectionListener() {
    if (connectionUnsubscribe) connectionUnsubscribe();
    connectionUnsubscribe = null; firebaseConnected = false;
  }
  function showOnlineActions() {
    els.view.classList.remove("is-matched");
    document.querySelector(".online-panel")?.classList.remove("is-matched");
    els.roomPanel.hidden = true;
    els.formation.hidden = true;
    els.actions.hidden = false;
    els.newRoom.hidden = true;
  }
  async function returnToModeSelect() {
    // This is navigation only: retain sessionStorage so Online can restore the room.
    await stopPresence();
    stopRoomListeners();
    stopConnectionListener();
    els.view.hidden = true;
    showOnlineActions();
    $("startView").hidden = false;
    showError();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function exitRoom() {
    showError();
    const active = currentRoom;
    if (!active) { showOnlineActions(); return; }
    window.CPUOnlineBattleUI?.end();
    const roomRef = ref(db, roomPath(active.roomId));
    try {
      const snapshot = await get(roomRef);
      const room = snapshot.val();
      if (room && active.role === "host" && room.status === "waiting" && !room.players?.guest?.uid) {
        await remove(roomRef);
      } else if (room && !room.exit) {
        const marker = { uid: auth.currentUser.uid, role: active.role, endedAt: Date.now() };
        await runTransaction(ref(db, `${roomPath(active.roomId)}/exit`), current => current == null ? marker : undefined, { applyLocally: false });
      }
    } catch (error) {
      showError(`退出通知をFirebaseへ保存できませんでした。接続を確認してもう一度お試しください。${errorText(error)}`);
      return;
    }
    await stopPresence();
    try { sessionStorage.removeItem("saikisenki-online-room"); } catch {}
    stopRoomListeners();
    showOnlineActions();
    showError("ルームから退出しました。このページを開き直しても以前のルームには復帰しません。");
  }
  async function handleOpponentExit() {
    if (handlingOpponentExit || !currentRoom) return;
    handlingOpponentExit = true;
    window.CPUOnlineBattleUI?.end();
    try { await stopPresence(); } catch {}
    try { sessionStorage.removeItem("saikisenki-online-room"); } catch {}
    stopRoomListeners();
    showOnlineActions();
    showError("対戦相手がルームを退出しました。部屋を作るか、別のルームに参加してください。");
    window.scrollTo({ top: 0, behavior: "smooth" });
    handlingOpponentExit = false;
  }
  async function createNewWaitingRoom() {
    if (!currentRoom || currentRoom.role !== "host") return;
    showError();
    els.newRoom.disabled = true;
    try {
      const roomRef = ref(db, roomPath(currentRoom.roomId));
      const snapshot = await get(roomRef);
      const room = snapshot.val();
      if (!room || room.status !== "waiting" || room.players?.guest?.uid) {
        els.newRoom.hidden = true;
        throw new Error("相手が参加したため、このルームは削除しませんでした。");
      }
      await stopPresence();
      await remove(roomRef);
      try { sessionStorage.removeItem("saikisenki-online-room"); } catch {}
      stopRoomListeners();
      els.roomPanel.hidden = true;
      els.formation.hidden = true;
      els.actions.hidden = false;
      await createRoom();
    } catch (error) {
      if (currentRoom && firebaseConnected) syncPresence();
      showError(errorText(error));
    } finally { els.newRoom.disabled = false; }
  }
  els.mode.addEventListener("click", enterOnline);
  els.back.addEventListener("click", returnToModeSelect);
  els.exitRoom.addEventListener("click", exitRoom);
  els.newRoom.addEventListener("click", createNewWaitingRoom);
  els.create.addEventListener("click", createRoom);
  els.join.addEventListener("click", joinRoom);
  els.input.addEventListener("input", () => { els.input.value = els.input.value.replace(/\D/g, "").slice(0, 6); });
  els.input.addEventListener("keydown", event => { if (event.key === "Enter") joinRoom(); });
  els.cards.addEventListener("click", event => {
    const detail = event.target.closest("[data-formation-detail]");
    if (detail) { window.CPUFormationUI.showCardDetail(detail.dataset.formationDetail); return; }
    const button = event.target.closest(".game-card[data-instance]");
    if (!button || !onlineDeal || onlineFormation?.ready) return;
    const id = button.dataset.instance;
    if (onlineBattleIds.includes(id)) onlineBattleIds = onlineBattleIds.filter(value => value !== id);
    else if (onlineBattleIds.length < 5) onlineBattleIds = [...onlineBattleIds, id];
    else { els.formationError.textContent = "バトルカードは最大5枚まで選べます。"; return; }
    get(ref(db, roomPath(currentRoom.roomId))).then(snapshot => { if (snapshot.exists()) renderOnlineFormation(snapshot.val()); }).catch(error => showError(errorText(error)));
  });
  els.cards.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const detail = event.target.closest("[data-formation-detail]");
    if (detail) { event.preventDefault(); window.CPUFormationUI.showCardDetail(detail.dataset.formationDetail); return; }
    const card = event.target.closest(".game-card[data-instance]");
    if (card && !onlineFormation?.ready) { event.preventDefault(); card.click(); }
  });
  $("onlineAutoFormationButton")?.addEventListener("click", () => {
    if (!onlineDeal || onlineFormation?.ready) return;
    const definitionIds = onlineDeal.cards.map(item => item.definitionId);
    const pickedDefinitions = window.CPUFormationUI.getBattleIds(definitionIds);
    const queues = new Map();
    for (const item of onlineDeal.cards) {
      const ids = queues.get(item.definitionId) || [];
      ids.push(item.instanceId);
      queues.set(item.definitionId, ids);
    }
    onlineBattleIds = pickedDefinitions.map(id => queues.get(id)?.shift()).filter(Boolean);
    get(ref(db, roomPath(currentRoom.roomId))).then(snapshot => { if (snapshot.exists()) renderOnlineFormation(snapshot.val()); }).catch(error => showError(errorText(error)));
  });
  els.ready.addEventListener("click", async () => {
    if (!currentRoom || !auth.currentUser || onlineFormation?.ready) return;
    const formation = window.OnlineRoomSchema.createOnlineFormation(onlineBattleIds, onlineDeal);
    if (!formation) { els.formationError.textContent = "バトルカードを1〜5枚選んでください。"; return; }
    els.ready.disabled = true;
    try {
      const uid = auth.currentUser.uid;
      const updates = {};
      updates[`${privatePath(currentRoom.roomId, uid)}/formation`] = formation;
      updates[`${roomPath(currentRoom.roomId)}/players/${currentRoom.role}/ready`] = true;
      await update(ref(db), updates);
      onlineFormation = formation;
      const snapshot = await get(ref(db, roomPath(currentRoom.roomId)));
      if (snapshot.exists()) renderOnlineFormation(snapshot.val());
    } catch (error) {
      els.ready.disabled = onlineBattleIds.length < 1;
      els.formationError.textContent = errorText(error);
    }
  });
})();
