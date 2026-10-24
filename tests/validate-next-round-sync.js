const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../online-battle-core.js");

async function main() {
  const active = new Set();
  const order = [];
  let peak = 0;
  const queue = core.createSerialQueue(async item => {
    active.add(item);
    peak = Math.max(peak, active.size);
    await new Promise(resolve => setTimeout(resolve, item === "host" ? 12 : 2));
    order.push(item);
    active.delete(item);
  });

  await Promise.all([queue("host"), queue("guest"), queue("snapshot")]);
  assert.equal(peak, 1, "Firebase room snapshots must be processed one at a time");
  assert.deepEqual(order, ["host", "guest", "snapshot"], "queued snapshots must preserve arrival order");

  const errors = [];
  const resilientQueue = core.createSerialQueue(async value => {
    if (value === "bad") throw new Error("expected failure");
    order.push(value);
  }, error => errors.push(error.message));
  await assert.rejects(resilientQueue("bad"), /expected failure/);
  await resilientQueue("after-error");
  assert.deepEqual(errors, ["expected failure"]);
  assert.equal(order.at(-1), "after-error", "a failed snapshot must not block later snapshots");

  const round = {
    supportCommits: { host: "a", guest: "b" }, supportReveals: { host: {}, guest: {} },
    actionCommits: { host: "a", guest: "b" }, actionReveals: { host: {}, guest: {} },
    rerolls: { host: false, guest: false },
    resultClaims: { host: { hash: "same" }, guest: { hash: "same" } }, nextReady: { host: true, guest: true }
  };
  assert.equal(core.phaseFor(round, "host"), "settled");
  assert.equal(core.phaseFor(round, "guest"), "settled");
  assert.equal(core.isSettledRound(round), true, "round advance still requires matching result hashes");

  const gameSource = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
  assert.match(gameSource, /onlineBattleStatus\.includes\("同期中"\)/, "the next-round button stays disabled during shared-counter synchronization");

  console.log("next-round sync queue and settled-state checks passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
