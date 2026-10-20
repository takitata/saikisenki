/* Shared CPU roster and formation helpers for the browser and balance simulator. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CPU_DECK = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  // Shared weighted rarity distribution for both CPU and online player rosters.
  const RARITY_PATTERNS = Object.freeze([
    Object.freeze({ normal: 12, rare: 3, legend: 0, weight: 54 }),
    Object.freeze({ normal: 13, rare: 2, legend: 0, weight: 20 }),
    Object.freeze({ normal: 11, rare: 4, legend: 0, weight: 17 }),
    Object.freeze({ normal: 12, rare: 2, legend: 1, weight: 4 }),
    Object.freeze({ normal: 10, rare: 5, legend: 0, weight: 3 }),
    Object.freeze({ normal: 11, rare: 3, legend: 1, weight: 2 })
  ]);

  function shuffle(items, rng) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function pickRarityPattern(rng = Math.random) {
    const total = RARITY_PATTERNS.reduce((sum, pattern) => sum + pattern.weight, 0);
    let roll = rng() * total;
    for (const pattern of RARITY_PATTERNS) {
      roll -= pattern.weight;
      if (roll < 0) return pattern;
    }
    return RARITY_PATTERNS[RARITY_PATTERNS.length - 1];
  }

  function drawWithReplacement(pool, count, rng) {
    if (count > 0 && pool.length === 0) throw new Error("Cannot draw from an empty rarity pool");
    return Array.from({ length: count }, () => pool[Math.floor(rng() * pool.length)]);
  }

  function battleValue(card) {
    const mean = card.dice.reduce((sum, value) => sum + value, 0) / 6;
    return card.baseHp * 0.13 + mean * 0.68 + (card.passives?.length || 0) * 7 + (card.triggers?.length || 0) * 2;
  }

  // This is the same noisy value heuristic used by the balance simulator.
  function chooseBattleIds(cardIds, cardMap, count = 5, rng = Math.random) {
    const definitions = cardIds.map(id => ({ id, card: cardMap instanceof Map ? cardMap.get(id) : cardMap[id] }));
    const exclusive = definitions.filter(item => item.card?.formationRestriction?.exclusive);
    if (exclusive.length) return [exclusive[0].id];
    const ranked = cardIds.map(id => {
      const card = cardMap instanceof Map ? cardMap.get(id) : cardMap[id];
      if (!card) throw new Error(`Unknown card in CPU roster: ${id}`);
      const randomNoise = (rng() + rng() + rng() - 1.5) * 34;
      return { id, score: battleValue(card) + randomNoise };
    }).sort((a, b) => b.score - a.score);
    return ranked.slice(0, Math.min(count, ranked.length)).map(item => item.id);
  }

  function chooseBattleInstances(ownedCards, cardMap, count = 5, rng = Math.random) {
    const ranked = ownedCards.map((owned, index) => {
      const cardId = owned.cardId || owned.definitionId;
      const card = cardMap instanceof Map ? cardMap.get(cardId) : cardMap[cardId];
      if (!card) throw new Error(`Unknown card in roster: ${cardId}`);
      const randomNoise = (rng() + rng() + rng() - 1.5) * 34;
      return { instanceId: owned.instanceId, card, index, score: battleValue(card) + randomNoise };
    });
    const exclusive = ranked.filter(item => item.card.formationRestriction?.exclusive);
    if (exclusive.length) return [exclusive[0].instanceId];
    return ranked.sort((a, b) => b.score - a.score).slice(0, Math.min(count, ranked.length)).map(item => item.instanceId);
  }

  function generateRoster(cardData, rng = Math.random) {
    const rares = cardData.filter(card => card.rarity === "rare");
    const normals = cardData.filter(card => card.rarity === "normal");
    const legends = cardData.filter(card => card.rarity === "legend");
    if (!rares.length || !normals.length || !legends.length) throw new Error("Roster generation requires Normal, Rare, and Legend card definitions");
    const pattern = pickRarityPattern(rng);
    const selected = [
      ...drawWithReplacement(normals, pattern.normal, rng),
      ...drawWithReplacement(rares, pattern.rare, rng),
      ...drawWithReplacement(legends, pattern.legend, rng)
    ];
    const cards = shuffle(selected, rng);
    return {
      normalCount: pattern.normal,
      rareCount: pattern.rare,
      legendCount: pattern.legend,
      rarityPattern: { normal: pattern.normal, rare: pattern.rare, legend: pattern.legend },
      owned: cards.map((card, index) => ({ instanceId: `cpu-${String(index + 1).padStart(2, "0")}`, cardId: card.id })),
    };
  }

  return { RARITY_PATTERNS, pickRarityPattern, battleValue, chooseBattleIds, chooseBattleInstances, generateRoster, shuffle };
});
