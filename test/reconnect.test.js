const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createReconnect } = require('../public/js/reconnect');

describe('createReconnect', () => {
  it('should call onReconnect for each retry attempt', async () => {
    const attempts = [];
    const rc = createReconnect({
      delays: [10, 20, 30],
      onReconnect: (attempt, delay) => { attempts.push({ attempt, delay }); },
      onFailed: () => {},
    });

    rc.start();

    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(attempts.length, 3);
    assert.deepStrictEqual(attempts[0], { attempt: 1, delay: 10 });
    assert.deepStrictEqual(attempts[1], { attempt: 2, delay: 20 });
    assert.deepStrictEqual(attempts[2], { attempt: 3, delay: 30 });
  });

  it('should call onFailed after all retries exhausted', async () => {
    let failed = false;
    const rc = createReconnect({
      delays: [10, 10],
      onReconnect: () => {},
      onFailed: () => { failed = true; },
    });

    rc.start();

    await new Promise((r) => setTimeout(r, 60));

    assert.strictEqual(failed, true);
  });

  it('should stop retrying after cancel()', async () => {
    let attempts = 0;
    const rc = createReconnect({
      delays: [10, 50, 50],
      onReconnect: () => { attempts++; },
      onFailed: () => {},
    });

    rc.start();

    // Wait for first attempt
    await new Promise((r) => setTimeout(r, 20));
    rc.cancel();

    const countAfterCancel = attempts;

    // Wait — no more attempts should fire
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(attempts, countAfterCancel);
    assert.strictEqual(attempts, 1);
  });

  it('should not call onFailed if cancelled before exhausting', async () => {
    let failed = false;
    const rc = createReconnect({
      delays: [10, 20, 30],
      onReconnect: () => {},
      onFailed: () => { failed = true; },
    });

    rc.start();

    // Cancel after first attempt
    await new Promise((r) => setTimeout(r, 20));
    rc.cancel();

    await new Promise((r) => setTimeout(r, 80));

    assert.strictEqual(failed, false);
  });

  it('should call onReconnect which returns true to stop further retries (success)', async () => {
    let attempts = 0;
    const rc = createReconnect({
      delays: [10, 20, 30],
      onReconnect: () => {
        attempts++;
        return true; // signal success — stop retrying
      },
      onFailed: () => {},
    });

    rc.start();

    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(attempts, 1);
  });
});
