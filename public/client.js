(function () {
  const socket = io();

  function getClientId() {
    let id = localStorage.getItem('poll_client_id');
    if (!id) {
      id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('poll_client_id', id);
    }
    return id;
  }
  const clientId = getClientId();

  function votedKey(pollId) { return 'poll_voted_' + pollId; }
  function hasVoted(pollId) { return localStorage.getItem(votedKey(pollId)) === '1'; }
  function markVoted(pollId) { localStorage.setItem(votedKey(pollId), '1'); }
  function clearVoted(pollId) { localStorage.removeItem(votedKey(pollId)); }

  const waitingEl = document.getElementById('waiting');
  const pollCard = document.getElementById('pollCard');
  const questionText = document.getElementById('questionText');
  const optionsList = document.getElementById('optionsList');
  const voteView = document.getElementById('voteView');
  const resultsView = document.getElementById('resultsView');
  const resultsList = document.getElementById('resultsList');
  const totalVotesEl = document.getElementById('totalVotes');
  const thanksText = document.getElementById('thanksText');

  function renderResults(poll) {
    resultsList.innerHTML = '';
    poll.options.forEach(opt => {
      const pct = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `
        <div class="label"><span>${escapeHtml(opt.text)}</span><span>${pct}% (${opt.votes})</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      `;
      resultsList.appendChild(row);
    });
    totalVotesEl.textContent = `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'} total`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function render(poll) {
    if (!poll || poll.status !== 'open') {
      if (poll && poll.status === 'closed') {
        // Keep showing results if we have them, but no live poll object after close.
      }
      waitingEl.classList.remove('hidden');
      pollCard.classList.add('hidden');
      return;
    }

    waitingEl.classList.add('hidden');
    pollCard.classList.remove('hidden');
    questionText.textContent = poll.question;

    const alreadyVoted = hasVoted(poll.id);

    if (alreadyVoted) {
      voteView.classList.add('hidden');
      resultsView.classList.remove('hidden');
      thanksText.textContent = 'Thanks for voting! Live results:';
      renderResults(poll);
    } else {
      voteView.classList.remove('hidden');
      resultsView.classList.add('hidden');
      optionsList.innerHTML = '';
      poll.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'option';
        btn.textContent = opt.text;
        btn.addEventListener('click', () => {
          markVoted(poll.id);
          socket.emit('vote', { pollId: poll.id, optionIndex: idx, clientId });
        });
        optionsList.appendChild(btn);
      });
    }
  }

  socket.on('poll:state', (poll) => {
    render(poll);
  });

  socket.on('poll:reset', ({ pollId }) => {
    clearVoted(pollId);
  });

  socket.on('brand:state', (brand) => window.applyBrand(brand));
})();
