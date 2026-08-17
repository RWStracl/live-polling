(function () {
  const socket = io();

  const loginCard = document.getElementById('loginCard');
  const adminArea = document.getElementById('adminArea');
  const passwordInput = document.getElementById('passwordInput');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');

  const shareUrl = document.getElementById('shareUrl');
  const questionInput = document.getElementById('questionInput');
  const optionInputs = document.getElementById('optionInputs');
  const addOptionBtn = document.getElementById('addOptionBtn');
  const createPollBtn = document.getElementById('createPollBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const formTitle = document.getElementById('formTitle');
  const createError = document.getElementById('createError');
  const createSuccess = document.getElementById('createSuccess');
  const pollList = document.getElementById('pollList');
  const liveResults = document.getElementById('liveResults');
  const liveTotalVotes = document.getElementById('liveTotalVotes');
  const resultsHeading = document.getElementById('resultsHeading');
  const backToLiveBtn = document.getElementById('backToLiveBtn');

  shareUrl.textContent = 'Share with participants: ' + window.location.origin + '/';

  const brandButtons = Array.from(document.querySelectorAll('#brandSwitch button[data-brand]'));
  brandButtons.forEach(btn => {
    btn.addEventListener('click', () => socket.emit('admin:setBrand', btn.dataset.brand));
  });
  socket.on('brand:state', (brand) => {
    brandButtons.forEach(btn => btn.classList.toggle('btn-active', btn.dataset.brand === brand));
  });

  function addOptionInput(value) {
    const row = document.createElement('div');
    row.className = 'option-input-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Option text';
    input.value = value || '';
    row.appendChild(input);
    optionInputs.appendChild(row);
  }

  function resetOptionInputs() {
    optionInputs.innerHTML = '';
    addOptionInput('');
    addOptionInput('');
  }
  resetOptionInputs();

  addOptionBtn.addEventListener('click', () => addOptionInput(''));

  // Clear stale validation errors as soon as the admin edits the form again,
  // so a fixed field doesn't still show the old "Enter a question" message.
  function clearCreateMessages() {
    createError.classList.add('hidden');
    createSuccess.classList.add('hidden');
  }
  questionInput.addEventListener('input', clearCreateMessages);
  optionInputs.addEventListener('input', clearCreateMessages);

  let editingPollId = null;

  function enterEditMode(poll) {
    editingPollId = poll.id;
    questionInput.value = poll.question;
    optionInputs.innerHTML = '';
    poll.options.forEach(o => addOptionInput(o.text));
    formTitle.textContent = 'Edit Question';
    createPollBtn.textContent = 'Update Question';
    cancelEditBtn.classList.remove('hidden');
    clearCreateMessages();
    questionInput.focus();
    questionInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function exitEditMode() {
    editingPollId = null;
    questionInput.value = '';
    resetOptionInputs();
    formTitle.textContent = 'New Question';
    createPollBtn.textContent = 'Save Question';
    cancelEditBtn.classList.add('hidden');
    clearCreateMessages();
  }

  cancelEditBtn.addEventListener('click', exitEditMode);

  function attemptLogin(pwOverride) {
    const pw = pwOverride !== undefined ? pwOverride : passwordInput.value;
    socket.emit('admin:auth', pw, (res) => {
      if (res.ok) {
        loginCard.classList.add('hidden');
        adminArea.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');
        loginError.classList.add('hidden');
        sessionStorage.setItem('poll_admin_pw', pw);
      } else {
        loginError.textContent = res.error || 'Login failed';
        loginError.classList.remove('hidden');
      }
    });
  }

  loginBtn.addEventListener('click', () => attemptLogin());
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptLogin();
  });

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('poll_admin_pw');
    passwordInput.value = '';
    adminArea.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    loginCard.classList.remove('hidden');
    // The server-side socket still considers this connection authenticated,
    // so reconnect on a fresh socket to actually drop admin privileges.
    socket.disconnect().connect();
  });

  const initialSavedPw = sessionStorage.getItem('poll_admin_pw');
  if (initialSavedPw) {
    passwordInput.value = initialSavedPw;
  }
  // Auto-login on every (re)connect if a password is still saved for this
  // session — re-read from sessionStorage each time so a logout sticks even
  // if the socket reconnects afterward.
  socket.on('connect', () => {
    const pw = sessionStorage.getItem('poll_admin_pw');
    if (pw) attemptLogin(pw);
  });

  createPollBtn.addEventListener('click', () => {
    const question = questionInput.value.trim();
    const options = Array.from(optionInputs.querySelectorAll('input'))
      .map(i => i.value.trim())
      .filter(Boolean);

    createSuccess.classList.add('hidden');

    if (!question) {
      createError.textContent = 'Enter a question.';
      createError.classList.remove('hidden');
      return;
    }
    if (options.length < 2) {
      createError.textContent = 'Enter at least two options.';
      createError.classList.remove('hidden');
      return;
    }
    createError.classList.add('hidden');

    if (editingPollId) {
      socket.emit('admin:updatePoll', { pollId: editingPollId, question, options });
      exitEditMode();
      createSuccess.textContent = 'Question updated.';
      createSuccess.classList.remove('hidden');
    } else {
      socket.emit('admin:createPoll', { question, options });
      questionInput.value = '';
      resetOptionInputs();
      createSuccess.textContent = 'Saved! Find it in "Questions" below and click Open to show it live.';
      createSuccess.classList.remove('hidden');
    }
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderPollList(polls) {
    pollList.innerHTML = '';
    if (polls.length === 0) {
      pollList.innerHTML = '<p class="subtitle">No questions yet. Create one above.</p>';
      return;
    }
    polls.forEach(p => {
      const item = document.createElement('div');
      item.className = 'poll-list-item';

      const meta = document.createElement('div');
      meta.className = 'poll-meta';
      meta.innerHTML = `${escapeHtml(p.question)} <span class="status-badge ${p.status}">${p.status}</span>
        <div class="subtitle" style="margin:2px 0 0;">${p.totalVotes} vote${p.totalVotes === 1 ? '' : 's'}</div>`;

      const actions = document.createElement('div');
      actions.className = 'row';

      if (p.status !== 'open') {
        const openBtn = document.createElement('button');
        openBtn.className = 'btn small';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => socket.emit('admin:openPoll', p.id));
        actions.appendChild(openBtn);
      } else {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn secondary small';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', () => socket.emit('admin:closePoll', p.id));
        actions.appendChild(closeBtn);
      }

      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn secondary small';
      resetBtn.textContent = 'Reset votes';
      resetBtn.addEventListener('click', () => {
        if (confirm('Reset all votes for this question?')) {
          socket.emit('admin:resetPoll', p.id);
        }
      });
      actions.appendChild(resetBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn danger small';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        if (confirm('Delete this question permanently?')) {
          socket.emit('admin:deletePoll', p.id);
        }
      });

      const editBtn = document.createElement('button');
      editBtn.className = 'btn secondary small';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => enterEditMode(p));

      const duplicateBtn = document.createElement('button');
      duplicateBtn.className = 'btn secondary small';
      duplicateBtn.textContent = 'Duplicate';
      duplicateBtn.addEventListener('click', () => socket.emit('admin:duplicatePoll', p.id));

      const viewResultsBtn = document.createElement('button');
      viewResultsBtn.className = 'btn secondary small';
      viewResultsBtn.textContent = 'View results';
      viewResultsBtn.addEventListener('click', () => showResultsFor(p.id));

      actions.appendChild(viewResultsBtn);
      actions.appendChild(editBtn);
      actions.appendChild(duplicateBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(meta);
      item.appendChild(actions);
      pollList.appendChild(item);
    });
  }

  let latestPolls = [];
  let currentOpenPoll = null;
  let pinnedPollId = null; // set when the admin clicks "View results" on a specific question

  function renderResultsPanel(poll) {
    liveResults.innerHTML = '';
    if (!poll) {
      liveTotalVotes.textContent = 'No question is currently open.';
      return;
    }
    poll.options.forEach(opt => {
      const pct = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `
        <div class="label"><span>${escapeHtml(opt.text)}</span><span>${pct}% (${opt.votes})</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      `;
      liveResults.appendChild(row);
    });
    liveTotalVotes.textContent = `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'} total — "${poll.question}"`;
  }

  function refreshResultsPanel() {
    if (pinnedPollId) {
      const pinned = latestPolls.find(p => p.id === pinnedPollId);
      if (!pinned) {
        // The pinned question was deleted; fall back to the live one.
        pinnedPollId = null;
      } else {
        resultsHeading.textContent = `Results: "${pinned.question}" (${pinned.status})`;
        backToLiveBtn.classList.remove('hidden');
        renderResultsPanel(pinned);
        return;
      }
    }
    resultsHeading.textContent = 'Live results (open question)';
    backToLiveBtn.classList.add('hidden');
    renderResultsPanel(currentOpenPoll);
  }

  function showResultsFor(pollId) {
    pinnedPollId = pollId;
    refreshResultsPanel();
  }

  backToLiveBtn.addEventListener('click', () => {
    pinnedPollId = null;
    refreshResultsPanel();
  });

  socket.on('admin:polls', (polls) => {
    latestPolls = polls;
    renderPollList(polls);
    refreshResultsPanel();
  });

  socket.on('poll:state', (poll) => {
    currentOpenPoll = poll;
    refreshResultsPanel();
  });
})();
