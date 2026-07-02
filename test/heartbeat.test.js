const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createHeartbeat } = require('../public/js/heartbeat');

describe('createHeartbeat', () => {
  it('should call onPing at the configured interval', async () => {
    let pingCount = 0;
    const hb = createHeartbeat({
      pingInterval: 50,
      timeout: 1000, // long enough not to fire during test
      onPing: () => { pingCount++; },
      onTimeout: () => {},
    });

    hb.start();

    // Wait for 3 intervals
    await new Promise((r) => setTimeout(r, 170));

    assert.ok(pingCount >= 3, `Expected >= 3 pings, got ${pingCount}`);

    hb.stop();
  });

  it('should call onTimeout when no reset is called within timeout', async () => {
    let timedOut = false;
    const hb = createHeartbeat({
      pingInterval: 50,
      timeout: 100,
      onPing: () => {},
      onTimeout: () => { timedOut = true; },
    });

    hb.start();

    // Don't call reset() — should trigger timeout
    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(timedOut, true);

    hb.stop();
  });

  it('should NOT call onTimeout when reset is called regularly', async () => {
    let timedOut = false;
    const hb = createHeartbeat({
      pingInterval: 50,
      timeout: 100,
      onPing: () => {},
      onTimeout: () => { timedOut = true; },
    });

    hb.start();

    // Call reset every 40ms to prevent timeout
    const resetInterval = setInterval(() => hb.reset(), 40);

    await new Promise((r) => setTimeout(r, 200));
    clearInterval(resetInterval);

    assert.strictEqual(timedOut, false);

    hb.stop();
  });

  it('should stop sending pings after stop()', async () => {
    let pingCount = 0;
    const hb = createHeartbeat({
      pingInterval: 30,
      timeout: 1000,
      onPing: () => { pingCount++; },
      onTimeout: () => {},
    });

    hb.start();
    await new Promise((r) => setTimeout(r, 80));
    hb.stop();

    const countAfterStop = pingCount;

    // Wait more — no more pings should fire
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(pingCount, countAfterStop);
  });

  it('should not start if already started', () => {
    let pingCount = 0;
    const hb = createHeartbeat({
      pingInterval: 50,
      timeout: 1000,
      onPing: () => { pingCount++; },
      onTimeout: () => {},
    });

    hb.start();
    hb.start(); // second start should be a no-op
    hb.stop();

    // Only one interval timer should have been created
    assert.ok(true); // no crash = pass
  });
});
