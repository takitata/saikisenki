/* Development-only collection setup. Replace this module when progression grants cards. */
(() => {
  window.DEV_CARD_POOL_CONFIG = {
    initialPlayerSelection: [
      "n-red-warrior", "n-red-dragon", "n-red-vampire", "r-red-revenge-knight",
      "n-blue-knight", "n-blue-amoeba", "n-blue-time-mage", "r-blue-sealer",
      "n-green-healer", "n-green-tree", "n-green-ranger", "r-green-great-fairy",
      "n-white-adventurer", "n-white-knight", "r-white-sword-saint"
    ],
    cpuDeck: [
      "n-blue-warrior", "r-red-reverse-swordsman", "n-green-monk", "r-blue-illusionist", "n-white-mercenary",
      "n-red-bomber", "r-green-beast-king", "n-blue-golem", "r-white-hunter", "n-green-ranger",
      "n-red-spearman", "n-white-knight", "r-green-paladin", "n-blue-sealer", "n-white-summoner"
    ],
    cpuBattleIndexes: [0, 2, 4, 6, 9]
  };
})();
