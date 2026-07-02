// Reconnection state machine — manages exponential backoff retry logic
// Works in both Node.js (via module.exports) and browser (via window)

(function () {
  /**
   * Create a reconnection controller.
   * @param {{
   *   delays: number[],                       // retry delays in ms
   *   onReconnect: (attempt: number, delay: number) => boolean | void,  // return true to stop
   *   onFailed: () => void                    // called when all retries exhausted
   * }} config
   * @returns {{ start: () => void, cancel: () => void }}
   */
  function createReconnect(config) {
    const { delays, onReconnect, onFailed } = config;

    let cancelled = false;
    let timer = null;

    function schedule(attemptIndex) {
      if (cancelled || attemptIndex >= delays.length) return;

      const delay = delays[attemptIndex];
      const isLast = attemptIndex >= delays.length - 1;

      timer = setTimeout(() => {
        if (cancelled) return;

        const success = onReconnect(attemptIndex + 1, delay);

        if (success === true) {
          return; // reconnection succeeded, stop
        }

        if (isLast) {
          onFailed();
        } else {
          schedule(attemptIndex + 1);
        }
      }, delay);
    }

    function start() {
      cancelled = false;
      schedule(0);
    }

    function cancel() {
      cancelled = true;
      if (timer) { clearTimeout(timer); timer = null; }
    }

    return { start, cancel };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createReconnect };
  } else {
    window.createReconnect = createReconnect;
  }
})();
