(function () {
  const socket = io();

  const waitingEl = document.getElementById('waiting');
  const pollCard = document.getElementById('pollCard');
  const questionText = document.getElementById('questionText');
  const resultsList = document.getElementById('resultsList');
  const totalVotesEl = document.getElementById('totalVotes');

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function render(poll) {
    if (!poll || poll.status !== 'open') {
      waitingEl.classList.remove('hidden');
      pollCard.classList.add('hidden');
      return;
    }

    waitingEl.classList.add('hidden');
    pollCard.classList.remove('hidden');
    questionText.textContent = poll.question;

    resultsList.innerHTML = '';
    poll.options.forEach(opt => {
      const pct = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'present-result-row';
      row.innerHTML = `
        <div class="present-label"><span>${escapeHtml(opt.text)}</span><span>${pct}% (${opt.votes})</span></div>
        <div class="present-bar-track"><div class="present-bar-fill" style="width:${pct}%"></div></div>
      `;
      resultsList.appendChild(row);
    });
    totalVotesEl.textContent = `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'} total`;
  }

  socket.on('poll:state', render);
  socket.on('brand:state', (brand) => window.applyBrand(brand));
})();
