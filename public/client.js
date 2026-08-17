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
  function choiceKey(pollId) { return 'poll_choice_' + pollId; }
  function hasVoted(pollId) { return localStorage.getItem(votedKey(pollId)) === '1'; }
  function getChoice(pollId) {
    const raw = localStorage.getItem(choiceKey(pollId));
    return raw === null ? null : parseInt(raw, 10);
  }
  function markVoted(pollId, optionIndex) {
    localStorage.setItem(votedKey(pollId), '1');
    localStorage.setItem(choiceKey(pollId), String(optionIndex));
  }
  function clearVoted(pollId) {
    localStorage.removeItem(votedKey(pollId));
    localStorage.removeItem(choiceKey(pollId));
  }

  const waitingEl = document.getElementById('waiting');
  const pollCard = document.getElementById('pollCard');
  const questionText = document.getElementById('questionText');
  const optionsList = document.getElementById('optionsList');
  const voteView = document.getElementById('voteView');
  const resultsView = document.getElementById('resultsView');
  const resultsList = document.getElementById('resultsList');
  const totalVotesEl = document.getElementById('totalVotes');
  const thanksText = document.getElementById('thanksText');

  function renderResults(poll, choiceIndex, correctIndex) {
    resultsList.innerHTML = '';
    poll.options.forEach((opt, idx) => {
      const pct = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
      const isYourVote = idx === choiceIndex;
      const isCorrect = correctIndex !== null && idx === correctIndex;
      let badge = '';
      if (isYourVote && isCorrect) badge = ' <span class="your-vote-badge correct-badge">✓ Your vote — Correct!</span>';
      else if (isYourVote) badge = ' <span class="your-vote-badge">Your vote</span>';
      else if (isCorrect) badge = ' <span class="correct-badge">✓ Correct answer</span>';
      const row = document.createElement('div');
      row.className = 'result-row' + (isYourVote ? ' your-vote' : '') + (isCorrect ? ' correct-answer' : '');
      row.innerHTML = `
        <div class="label"><span>${escapeHtml(opt.text)}${badge}</span><span>${pct}% (${opt.votes})</span></div>
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
    // Once the admin reveals a correct answer, lock everyone (even
    // non-voters) into the results view instead of letting late votes in.
    const showResultsView = alreadyVoted || poll.revealed;

    if (showResultsView) {
      voteView.classList.add('hidden');
      resultsView.classList.remove('hidden');
      const choiceIndex = alreadyVoted ? getChoice(poll.id) : null;
      const choiceOption = choiceIndex !== null ? poll.options[choiceIndex] : null;
      const correctIndex = poll.correctIndex; // only non-null once revealed

      thanksText.classList.remove('wrong');
      if (correctIndex !== null) {
        if (choiceIndex === null) {
          thanksText.textContent = "Time's up! Here's the correct answer:";
        } else if (choiceIndex === correctIndex) {
          thanksText.textContent = `Correct! You voted "${choiceOption.text}".`;
        } else {
          thanksText.textContent = `Not quite — you voted "${choiceOption.text}".`;
          thanksText.classList.add('wrong');
        }
      } else if (choiceOption) {
        thanksText.textContent = `You voted "${choiceOption.text}". Live results:`;
      } else {
        thanksText.textContent = 'Thanks for voting! Live results:';
      }
      renderResults(poll, choiceIndex, correctIndex);
    } else {
      voteView.classList.remove('hidden');
      resultsView.classList.add('hidden');
      optionsList.innerHTML = '';
      poll.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'option';
        btn.textContent = opt.text;
        btn.addEventListener('click', () => {
          markVoted(poll.id, idx);
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
