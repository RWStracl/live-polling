(function () {
  const socket = io();

  const timerBlock = document.getElementById('timerBlock');
  const timerEl = document.getElementById('timerDisplay');
  const idleEl = document.getElementById('timerIdle');

  let timerState = { durationMs: 60000, remainingMs: 60000, endTime: null, running: false };
  let timerTickHandle = null;

  function formatMs(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function currentRemainingMs() {
    if (timerState.running && timerState.endTime) {
      return Math.max(0, timerState.endTime - Date.now());
    }
    return timerState.remainingMs;
  }

  function render() {
    const remaining = currentRemainingMs();
    const everUsed = timerState.running || timerState.remainingMs !== timerState.durationMs;
    if (!everUsed) {
      timerBlock.classList.add('hidden');
      idleEl.classList.remove('hidden');
      return;
    }
    idleEl.classList.add('hidden');
    timerBlock.classList.remove('hidden');
    timerEl.textContent = formatMs(remaining);
    timerEl.classList.toggle('timer-done', remaining <= 0);
  }

  function stopTick() {
    if (timerTickHandle) { clearInterval(timerTickHandle); timerTickHandle = null; }
  }

  function startTick() {
    stopTick();
    timerTickHandle = setInterval(render, 250);
  }

  socket.on('timer:state', (state) => {
    timerState = state;
    render();
    if (state.running) startTick(); else stopTick();
  });
})();
