/* Shared CPU roster and formation helpers for the browser and balance simulator. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CPU_DECK = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  // Weights are intentionally centralized for easy tuning during development.
  const RARE_COUNT_WEIGHTS = Object.freeze({ 2: 55, 3: 35, 4: 8, 5: 2 });

  function shuffle(items, rng) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function pickRareCount(rng = Math.random) {
    const entries = Object.entries(RARE_COUNT_WEIGHTS).map(([count, weight]) => [Number(count), weight]);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = rng() * total;
    for (const [count, weight] of entries) {
      roll -= weight;
      if (roll < 0) return count;
    }
    return entries[entries.length - 1][0];
  }

  function battleValue(card) {
    const mean = card.dice.reduce((sum, value) => sum + value, 0) / 6;
    return card.baseHp * 0.13 + mean * 0.68 + (card.passives?.length || 0) * 7 + (card.triggers?.length || 0) * 2;
  }

  // This is the same noisy value heuristic used by the balance simulator.
  function chooseBattleIds(cardIds, cardMap, count = 5, rng = Math.random) {
    const ranked = cardIds.map(id => {
      const card = cardMap instanceof Map ? cardMap.get(id) : cardMap[id];
      if (!card) throw new Error(`Unknown card in CPU roster: ${id}`);
      const randomNoise = (rng() + rng() + rng() - 1.5) * 34;
      return { id, score: battleValue(card) + randomNoise };
    }).sort((a, b) => b.score - a.score);
    return ranked.slice(0, Math.min(count, ranked.length)).map(item => item.id);
  }

  function generateRoster(cardData, rng = Math.random) {
    const rares = cardData.filter(card => card.rarity === "rare");
    const normals = cardData.filter(card => card.rarity === "normal");
    if (rares.length < 5 || normals.length < 10) throw new Error("CPU deck generation requires the full card pool");
    const rareCount = pickRareCount(rng);
    const selected = [...shuffle(rares, rng).slice(0, rareCount), ...shuffle(normals, rng).slice(0, 15 - rareCount)];
    const cards = shuffle(selected, rng);
    return {
      rareCount,
      owned: cards.map((card, index) => ({ instanceId: `cpu-${String(index + 1).padStart(2, "0")}`, cardId: card.id })),
    };
  }

  return { RARE_COUNT_WEIGHTS, pickRareCount, battleValue, chooseBattleIds, generateRoster, shuffle };
});
