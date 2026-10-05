/* Shared, non-secret schema seed for the Firebase room lobby. */
(() => {
  function createRoomSeed(hostUid, createdAt) {
    return {
      schemaVersion: 1,
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
      rareCount: roster.rareCount,
      cards: roster.owned.map((item, index) => ({
        instanceId: `${uid.slice(0, 8)}-${String(index + 1).padStart(2, "0")}`,
        definitionId: item.cardId,
        rarity: cardData.find(card => card.id === item.cardId)?.rarity || "normal"
      }))
    };
  }
  function createOnlineFormation(battleInstanceIds, deal) {
    if (!Array.isArray(battleInstanceIds) || battleInstanceIds.length < 1 || battleInstanceIds.length > 5) return null;
    const known = new Set((deal?.cards || []).map(card => card.instanceId));
    if (battleInstanceIds.some(id => !known.has(id)) || new Set(battleInstanceIds).size !== battleInstanceIds.length) return null;
    return { battleInstanceIds: [...battleInstanceIds], ready: true, readyAt: Date.now() };
  }
  window.OnlineRoomSchema = { createRoomSeed, claimGuestSlot, createOnlineDeal, createOnlineFormation };
})();
