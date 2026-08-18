(function () {
  const socket = io();

  const waitingEl = document.getElementById('waiting');
  const waitingText = document.getElementById('waitingText');
  const pollCard = document.getElementById('pollCard');
  const questionText = document.getElementById('questionText');
  const resultsList = document.getElementById('resultsList');
  const totalVotesEl = document.getElementById('totalVotes');
  const timerBlock = document.getElementById('timerBlock');
  const timerEl = document.getElementById('timerDisplay');
  const agendaImage = document.getElementById('agendaImage');

  const DEFAULT_WAITING_TEXT = 'Waiting for the next question…';
  let customMessage = '';
  function updateWaitingText() {
    waitingText.textContent = customMessage || DEFAULT_WAITING_TEXT;
  }
  socket.on('message:state', (text) => {
    customMessage = text || '';
    updateWaitingText();
  });

  socket.on('agenda:state', (dataUrl) => {
    if (dataUrl) {
      agendaImage.src = dataUrl;
      agendaImage.classList.remove('hidden');
    } else {
      agendaImage.classList.add('hidden');
      agendaImage.removeAttribute('src');
    }
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  let pollIsOpen = false;

  function render(poll) {
    pollIsOpen = !!(poll && poll.status === 'open');
    renderTimer(); // a question opening/closing also changes whether the timer should show

    if (!pollIsOpen) {
      waitingEl.classList.remove('hidden');
      pollCard.classList.add('hidden');
      return;
    }

    waitingEl.classList.add('hidden');
    pollCard.classList.remove('hidden');
    questionText.textContent = poll.question;

    resultsList.innerHTML = '';
    poll.options.forEach((opt, idx) => {
      const pct = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
      const isCorrect = poll.correctIndex !== null && idx === poll.correctIndex;
      const row = document.createElement('div');
      row.className = 'present-result-row' + (isCorrect ? ' present-correct-answer' : '');
      row.innerHTML = `
        <div class="present-label"><span>${escapeHtml(opt.text)}${isCorrect ? ' <span class="present-correct-badge">✓ Correct answer</span>' : ''}</span><span>${pct}% (${opt.votes})</span></div>
        <div class="present-bar-track"><div class="present-bar-fill" style="width:${pct}%"></div></div>
      `;
      resultsList.appendChild(row);
    });
    totalVotesEl.textContent = `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'} total`;
  }

  socket.on('poll:state', render);
  socket.on('brand:state', (brand) => window.applyBrand(brand));

  // ---- Timer ----
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

  function renderTimer() {
    const remaining = currentRemainingMs();
    const everUsed = timerState.running || timerState.remainingMs !== timerState.durationMs;
    if (!everUsed || pollIsOpen) {
      timerBlock.classList.add('hidden');
      return;
    }
    timerBlock.classList.remove('hidden');
    timerEl.textContent = formatMs(remaining);
    timerEl.classList.toggle('timer-done', remaining <= 0);
  }

  function stopTimerTick() {
    if (timerTickHandle) { clearInterval(timerTickHandle); timerTickHandle = null; }
  }

  function startTimerTick() {
    stopTimerTick();
    timerTickHandle = setInterval(renderTimer, 250);
  }

  socket.on('timer:state', (state) => {
    timerState = state;
    renderTimer();
    if (state.running) startTimerTick(); else stopTimerTick();
  });
})();
