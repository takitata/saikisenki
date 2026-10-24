/* Shared, non-secret schema seed for the Firebase room lobby. */
(() => {
  function createRoomSeed(hostUid, createdAt, mode = "random") {
    if (mode !== "random" && mode !== "free") throw new Error("Unknown online deck mode");
    return {
      schemaVersion: 1,
      mode,
      status: "waiting",
      createdAt,
      hostUid,
      players: {
        host: { uid: hostUid, ready: false },
        guest: { claimed: false, ready: false }
      },
      presence: {
        host: { connected: true, changedAt: createdAt },
        guest: { connected: false }
      },
      game: {
        protocol: "commit-reveal-v1",
        phase: "formation",
        round: 0,
        // Empty strings are persisted as explicit empty slots; null would delete
        // each key and violate the room-create hasChildren validation.
        choiceCommitments: { host: "", guest: "" },
        choiceReveals: { host: "", guest: "" }
      }
    };
  }
  function claimGuestSlot(current, uid) {
    // RTDB can invoke a transaction updater with null before it has fetched the
    // server value. The server retries with the authoritative node before commit.
    if (current == null) return { claimed: true, uid, ready: false };
    if ((current.claimed === false && current.uid == null) || (current.claimed === true && current.uid == null)) {
      return { ...current, claimed: true, uid };
    }
    if (current.claimed === true && current.uid === uid) return current;
    return undefined;
  }
  function createOnlineDeal(uid, cardData, rng = Math.random) {
    const roster = window.CPU_DECK.generateRoster(cardData, rng);
    return {
      mode: "random",
      normalCount: roster.normalCount,
      rareCount: roster.rareCount,
      legendCount: roster.legendCount,
      cards: roster.owned.map((item, index) => ({
        instanceId: `${uid.slice(0, 8)}-${String(index + 1).padStart(2, "0")}`,
        definitionId: item.cardId,
        rarity: cardData.find(card => card.id === item.cardId)?.rarity || "normal"
      }))
    };
  }
  function createFreeDeckDeal(uid, role, definitionIds, cardData) {
    if (!Array.isArray(definitionIds) || definitionIds.length !== 15 || !["host", "guest"].includes(role)) return null;
    const definitions = new Map(cardData.map(card => [card.id, card]));
    const counts = { normal: 0, rare: 0, legend: 0 };
    const cards = definitionIds.map((definitionId, index) => {
      const definition = definitions.get(definitionId);
      if (!definition || !Object.hasOwn(counts, definition.rarity)) return null;
      counts[definition.rarity]++;
      return {
        instanceId: `${role}-free-${String(index).padStart(2, "0")}`,
        definitionId,
        rarity: definition.rarity
      };
    });
    if (cards.some(card => !card)) return null;
    return { mode: "free", normalCount: counts.normal, rareCount: counts.rare, legendCount: counts.legend, cards };
  }
  function validateOnlineDeal(deal, cardData, mode = "random", uid = "", role = "host") {
    if (!deal || !Array.isArray(deal.cards) || deal.cards.length !== 15) return false;
    const definitions = new Map(cardData.map(card => [card.id, card]));
    if (new Set(deal.cards.map(card => card.instanceId)).size !== 15) return false;
    for (const [index, item] of deal.cards.entries()) {
      const definition = definitions.get(item.definitionId);
      if (!definition || item.rarity !== definition.rarity || typeof item.instanceId !== "string") return false;
      if (mode === "free" && item.instanceId !== `${role}-free-${String(index).padStart(2, "0")}`) return false;
    }
    const counts = { normal: 0, rare: 0, legend: 0 };
    for (const item of deal.cards) counts[item.rarity]++;
    if (counts.normal !== deal.normalCount || counts.rare !== deal.rareCount || counts.legend !== deal.legendCount) return false;
    if (mode === "free") return deal.mode === "free" && counts.normal + counts.rare + counts.legend === 15;
    return [[12,3,0],[13,2,0],[11,4,0],[12,2,1],[10,5,0],[11,3,1]].some(([normal,rare,legend]) => normal === counts.normal && rare === counts.rare && legend === counts.legend);
  }
  function createOnlineFormation(battleInstanceIds, deal) {
    if (!Array.isArray(battleInstanceIds) || battleInstanceIds.length < 1 || battleInstanceIds.length > 5) return null;
    const known = new Set((deal?.cards || []).map(card => card.instanceId));
    if (battleInstanceIds.some(id => !known.has(id)) || new Set(battleInstanceIds).size !== battleInstanceIds.length) return null;
    const definitions = new Map((window.CARD_DATA || []).map(card => [card.id, card]));
    const chosen = battleInstanceIds.map(id => definitions.get(deal.cards.find(card => card.instanceId === id)?.definitionId));
    if (chosen.some(card => card?.formationRestriction?.exclusive) && battleInstanceIds.length !== 1) return null;
    return { battleInstanceIds: [...battleInstanceIds], ready: true, readyAt: Date.now() };
  }
  window.OnlineRoomSchema = { createRoomSeed, claimGuestSlot, createOnlineDeal, createFreeDeckDeal, validateOnlineDeal, createOnlineFormation };
})();
