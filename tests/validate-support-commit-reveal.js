const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
global.crypto = crypto.webcrypto;
const Core = require('../online-battle-core.js');

const nonce = 'a'.repeat(64);
const cases = [
  ['host', { supportId: 'card-1', supportDefinitionId: 'n-white-healer', reviveTargetId: '', switchTargetId: '', nonce }],
  ['guest', { supportId: 'switch-1', supportDefinitionId: 'n-green-treant', reviveTargetId: '', switchTargetId: 'battle-2', nonce }],
  ['host', { supportId: 'revive-1', supportDefinitionId: 'l-red-suzaku', reviveTargetId: 'grave-1', switchTargetId: '', nonce }],
  ['guest', { supportId: '', supportDefinitionId: '', reviveTargetId: '', switchTargetId: '', nonce }]
];

(async () => {
  assert.equal(Core.supportCommitProtocol, 'saikisenki-support-v2');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const cacheKeys = [...html.matchAll(/(?:src|href)="(?:style\.css|cards\.js|cpu-deck\.js|dev-card-pool\.js|battle\.js|game\.js|online-schema\.js|online-battle-core\.js|online\.js)\?v=([^"]+)"/g)].map(match => match[1]);
  assert.ok(cacheKeys.length >= 9 && cacheKeys.every(key => key === 'friend-test-rarity-patterns-20261020'),
    'all local app assets use the same cache-busting release key');
  for (const [role, choice] of cases) {
    const round = 7;
    const commitment = await Core.createSupportCommitment(round, role, choice);
    const restoredFromSessionStorageAndFirebase = JSON.parse(JSON.stringify(choice));
    assert.equal(await Core.verifySupportReveal(round, role, restoredFromSessionStorageAndFirebase, commitment), true,
      `${role} reveal verifies after JSON storage round-trip`);
    assert.equal(await Core.verifySupportReveal(round, role === 'host' ? 'guest' : 'host', restoredFromSessionStorageAndFirebase, commitment), false,
      'the commitment is bound to the fixed Firebase role');
    if (choice.switchTargetId) {
      assert.equal(await Core.verifySupportReveal(round, role, { ...restoredFromSessionStorageAndFirebase, switchTargetId: 'other-card' }, commitment), false,
        'switch target is committed');
    }
    if (choice.reviveTargetId) {
      assert.equal(await Core.verifySupportReveal(round, role, { ...restoredFromSessionStorageAndFirebase, reviveTargetId: 'other-grave-card' }, commitment), false,
        'revive target is committed');
    }
    assert.equal(await Core.verifySupportReveal(round, role, { ...restoredFromSessionStorageAndFirebase, nonce: 'b'.repeat(64) }, commitment), false,
      'nonce is committed');
  }

  for (const [role, choice] of [cases[0], cases[1], cases[3]]) {
    const legacyPayload = JSON.stringify({
      protocol: 'saikisenki-support-v1', round: 7, role,
      supportId: choice.supportId, supportDefinitionId: choice.supportDefinitionId,
      reviveTargetId: choice.reviveTargetId, nonce: choice.nonce
    });
    const legacyHash = await Core.sha256(legacyPayload);
    assert.equal(await Core.verifySupportReveal(7, role, choice, legacyHash), false,
      'legacy/mixed protocol commits stop safely instead of bypassing verification');
  }

  console.log('support commit-reveal v2: none, regular support, switch target, revive target, nonce, role binding, JSON round-trip, and legacy mismatch checks PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
