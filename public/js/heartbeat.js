// Heartbeat controller — manages ping/pong lifecycle for WebSocket connections
// Works in both Node.js (via module.exports) and browser (via window)

(function () {
  /**
   * Create a heartbeat controller.
   * @param {{ pingInterval: number, timeout: number, onPing: () => void, onTimeout: () => void }} config
   * @returns {{ start: () => void, stop: () => void, reset: () => void }}
   */
  function createHeartbeat(config) {
    const { pingInterval, timeout, onPing, onTimeout } = config;

    let pingTimer = null;
    let timeoutTimer = null;
    let started = false;

    function reset() {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        stop();
        onTimeout();
      }, timeout);
    }

    function start() {
      if (started) return;
      started = true;

      pingTimer = setInterval(() => {
        onPing();
      }, pingInterval);

      reset();
    }

    function stop() {
      started = false;
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    }

    return { start, stop, reset };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createHeartbeat };
  } else {
    window.createHeartbeat = createHeartbeat;
  }
})();
