const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

const app = express();
// Render terminates HTTPS at its edge and forwards plain HTTP internally, so
// trust its proxy headers to get the right protocol (https) in req.protocol.
app.set('trust proxy', true);
const server = http.createServer(app);
// Default 1MB packet cap is too small for an agenda image upload; raise it.
const io = new Server(server, { maxHttpBufferSize: 8 * 1024 * 1024 });

app.use(express.static(path.join(__dirname, 'public')));

// Renders a QR code for the participant join URL, based on whatever host/
// protocol the request actually came in on (works locally and once deployed).
app.get('/admin/qr.svg', async (req, res) => {
  const joinUrl = `${req.protocol}://${req.get('host')}/`;
  try {
    const svg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 220 });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    res.status(500).send('Failed to generate QR code');
  }
});

// ---- In-memory state (single classroom session, single server instance) ----
// poll: { id, question, className, options: [{ text, votes }], status: 'draft'|'open'|'closed',
//         voters: Set, correctIndex: number|null, revealed: boolean }
let polls = [];
let activePollId = null;

function normalizeCorrectIndex(value, optionsLength) {
  if (value === null || value === undefined || value === '') return null;
  const idx = Number(value);
  if (!Number.isInteger(idx) || idx < 0 || idx >= optionsLength) return null;
  return idx;
}

function resolveCorrectIndex(options, item) {
  if (typeof item.correctIndex === 'number') {
    return item.correctIndex >= 0 && item.correctIndex < options.length ? item.correctIndex : null;
  }
  if (typeof item.correctAnswer === 'string') {
    const idx = options.indexOf(item.correctAnswer.trim());
    return idx === -1 ? null : idx;
  }
  return null;
}

// Seed questions from polls-seed.json (if present) so they survive server
// restarts (e.g. Render's free tier spinning down after inactivity). Edit
// that file and push to git to change what loads on every restart.
function loadSeedPolls() {
  const seedPath = path.join(__dirname, 'polls-seed.json');
  if (!fs.existsSync(seedPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .map(item => {
        const question = String(item.question || '').trim();
        const options = (Array.isArray(item.options) ? item.options : [])
          .map(o => String(o || '').trim())
          .filter(Boolean);
        if (!question || options.length < 2) return null;
        return {
          id: crypto.randomUUID(),
          question,
          className: String(item.class || '').trim() || null,
          options: options.map(text => ({ text, votes: 0 })),
          status: 'draft',
          voters: new Set(),
          correctIndex: resolveCorrectIndex(options, item),
          revealed: false
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.error('Failed to load polls-seed.json:', err.message);
    return [];
  }
}
polls = loadSeedPolls();

const VALID_BRANDS = new Set(['none', 'stracl', 'jtask']);
let currentBrand = 'none'; // which logo/colors participants and the present view show

// Custom message shown on the Present view when no question is open (e.g. a
// break announcement or marketing tagline). Empty string = fall back to the
// default "Waiting for the next question..." text.
const MAX_MESSAGE_LENGTH = 200;
let presentMessage = '';

// Agenda/schedule image shown on the Present view during idle time (below
// the message). Stored in memory as a data: URL - replaced wholesale each
// time the admin uploads a new one; null = none set.
const MAX_AGENDA_IMAGE_BYTES = 6 * 1024 * 1024;
let agendaImage = null;

// ---- Countdown timer (independent of polls - for quiz time limits, group
// exercises, breaks, etc). Clients compute their own live countdown from
// endTime so every screen stays in sync without per-second broadcasts.
const MAX_TIMER_MS = 60 * 60 * 1000; // 1 hour sanity cap
let timer = {
  durationMs: 60000,
  remainingMs: 60000, // authoritative "frozen" value while paused/reset
  endTime: null,       // absolute ms epoch when running; null otherwise
  running: false
};

function publicTimer() {
  return {
    durationMs: timer.durationMs,
    remainingMs: timer.remainingMs,
    endTime: timer.endTime,
    running: timer.running
  };
}

function broadcastTimer() {
  io.emit('timer:state', publicTimer());
}

// Sent to EVERYONE (participants + present view + admin) via poll:state.
// The correct answer is only included once the admin has revealed it, so
// it can never be read from the wire (e.g. browser dev tools) beforehand.
function publicPoll(poll) {
  if (!poll) return null;
  return {
    id: poll.id,
    question: poll.question,
    status: poll.status,
    options: poll.options.map(o => ({ text: o.text, votes: o.votes })),
    totalVotes: poll.options.reduce((sum, o) => sum + o.votes, 0),
    hasCorrectAnswer: poll.correctIndex !== null,
    revealed: !!poll.revealed,
    correctIndex: poll.revealed ? poll.correctIndex : null
  };
}

// Admin-only payload (sent to the 'admins' room or a single freshly-authed
// socket) - safe to always include the real correctIndex here.
function publicPollList() {
  return polls.map(p => ({
    id: p.id,
    question: p.question,
    className: p.className || null,
    status: p.status,
    options: p.options.map(o => ({ text: o.text, votes: o.votes })),
    totalVotes: p.options.reduce((sum, o) => sum + o.votes, 0),
    correctIndex: p.correctIndex,
    revealed: !!p.revealed
  }));
}

function broadcastState() {
  const active = polls.find(p => p.id === activePollId) || null;
  io.emit('poll:state', publicPoll(active));
}

function broadcastAdminState(socket) {
  const listTarget = socket ? socket : io.to('admins');
  listTarget.emit('admin:polls', publicPollList());
  const stateTarget = socket ? socket : io;
  const active = polls.find(p => p.id === activePollId) || null;
  stateTarget.emit('poll:state', publicPoll(active));
}

io.on('connection', (socket) => {
  let isAdmin = false;

  // Send current state to any newly connected client
  const active = polls.find(p => p.id === activePollId) || null;
  socket.emit('poll:state', publicPoll(active));
  socket.emit('brand:state', currentBrand);
  socket.emit('timer:state', publicTimer());
  socket.emit('message:state', presentMessage);
  socket.emit('agenda:state', agendaImage);

  socket.on('admin:setBrand', (brand) => {
    if (!isAdmin) return;
    if (!VALID_BRANDS.has(brand)) return;
    currentBrand = brand;
    io.emit('brand:state', currentBrand);
  });

  socket.on('admin:setMessage', (text) => {
    if (!isAdmin) return;
    presentMessage = String(text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    io.emit('message:state', presentMessage);
  });

  socket.on('admin:setAgendaImage', (dataUrl, cb) => {
    if (!isAdmin) return;
    const ack = typeof cb === 'function' ? cb : () => {};
    if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(dataUrl)) {
      return ack({ ok: false, error: 'Not a valid image.' });
    }
    if (dataUrl.length > MAX_AGENDA_IMAGE_BYTES) {
      return ack({ ok: false, error: 'Image is too large (max 6MB).' });
    }
    agendaImage = dataUrl;
    io.emit('agenda:state', agendaImage);
    ack({ ok: true });
  });

  socket.on('admin:clearAgendaImage', () => {
    if (!isAdmin) return;
    agendaImage = null;
    io.emit('agenda:state', agendaImage);
  });

  socket.on('admin:timerAddTime', (ms) => {
    if (!isAdmin) return;
    const value = Number(ms);
    if (!Number.isFinite(value) || value === 0) return;
    if (timer.running && timer.endTime) {
      timer.endTime += value;
    } else {
      timer.remainingMs = Math.max(0, timer.remainingMs + value);
    }
    timer.durationMs = Math.min(MAX_TIMER_MS, Math.max(0, timer.durationMs + value));
    broadcastTimer();
  });

  socket.on('admin:timerSetDuration', (ms) => {
    if (!isAdmin) return;
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_MS) return;
    timer = { durationMs: value, remainingMs: value, endTime: null, running: false };
    broadcastTimer();
  });

  socket.on('admin:timerStart', () => {
    if (!isAdmin) return;
    if (timer.running || timer.remainingMs <= 0) return;
    timer.endTime = Date.now() + timer.remainingMs;
    timer.running = true;
    broadcastTimer();
  });

  socket.on('admin:timerPause', () => {
    if (!isAdmin) return;
    if (!timer.running) return;
    timer.remainingMs = Math.max(0, timer.endTime - Date.now());
    timer.endTime = null;
    timer.running = false;
    broadcastTimer();
  });

  socket.on('admin:timerReset', () => {
    if (!isAdmin) return;
    timer.remainingMs = timer.durationMs;
    timer.endTime = null;
    timer.running = false;
    broadcastTimer();
  });

  socket.on('admin:auth', (password, cb) => {
    if (password === ADMIN_PASSWORD) {
      isAdmin = true;
      socket.join('admins');
      cb({ ok: true });
      broadcastAdminState(socket);
    } else {
      cb({ ok: false, error: 'Incorrect password' });
    }
  });

  socket.on('admin:createPoll', (data) => {
    if (!isAdmin) return;
    const question = String(data.question || '').trim();
    const options = (Array.isArray(data.options) ? data.options : [])
      .map(o => String(o || '').trim())
      .filter(Boolean);
    if (!question || options.length < 2) return;

    const poll = {
      id: crypto.randomUUID(),
      question,
      className: null,
      options: options.map(text => ({ text, votes: 0 })),
      status: 'draft',
      voters: new Set(),
      correctIndex: normalizeCorrectIndex(data.correctIndex, options.length),
      revealed: false
    };
    polls.push(poll);
    broadcastAdminState();
  });

  socket.on('admin:openPoll', (pollId) => {
    if (!isAdmin) return;
    const poll = polls.find(p => p.id === pollId);
    if (!poll) return;
    // Close any currently open poll
    polls.forEach(p => { if (p.status === 'open') p.status = 'closed'; });
    poll.status = 'open';
    poll.revealed = false; // start fresh each time a question is (re)opened
    activePollId = poll.id;
    broadcastState();
    broadcastAdminState();
  });

  socket.on('admin:closePoll', (pollId) => {
    if (!isAdmin) return;
    const poll = polls.find(p => p.id === pollId);
    if (!poll) return;
    poll.status = 'closed';
    if (activePollId === pollId) activePollId = null;
    broadcastState();
    broadcastAdminState();
  });

  socket.on('admin:resetPoll', (pollId) => {
    if (!isAdmin) return;
    const poll = polls.find(p => p.id === pollId);
    if (!poll) return;
    poll.options.forEach(o => { o.votes = 0; });
    poll.voters = new Set();
    poll.revealed = false;
    // Tell every participant's browser to forget it already voted on this
    // poll, so a reset actually lets them vote again instead of leaving
    // them stuck on a stale "already voted" results view.
    io.emit('poll:reset', { pollId: poll.id });
    broadcastState();
    broadcastAdminState();
  });

  socket.on('admin:revealAnswer', (pollId) => {
    if (!isAdmin) return;
    const poll = polls.find(p => p.id === pollId);
    if (!poll || poll.correctIndex === null) return;
    poll.revealed = true;
    broadcastState();
    broadcastAdminState();
  });

  socket.on('admin:hideAnswer', (pollId) => {
    if (!isAdmin) return;
    const poll = polls.find(p => p.id === pollId);
    if (!poll) return;
    poll.revealed = false;
    broadcastState();
    broadcastAdminState();
  });

  socket.on('admin:updatePoll', ({ pollId, question, options, correctIndex } = {}) => {
    if (!isAdmin) return;
    const poll = polls.find(p => p.id === pollId);
    if (!poll) return;

    const q = String(question || '').trim();
    const opts = (Array.isArray(options) ? options : [])
      .map(o => String(o || '').trim())
      .filter(Boolean);
    if (!q || opts.length < 2) return;

    poll.question = q;
    if (opts.length === poll.options.length) {
      // Same option count: preserve existing vote counts by position.
      poll.options = poll.options.map((o, i) => ({ text: opts[i], votes: o.votes }));
    } else {
      // Option set changed shape: vote counts no longer map cleanly, so reset.
      poll.options = opts.map(text => ({ text, votes: 0 }));
      poll.voters = new Set();
    }
    poll.correctIndex = normalizeCorrectIndex(correctIndex, poll.options.length);
    broadcastState();
    broadcastAdminState();
  });

  socket.on('admin:duplicatePoll', (pollId) => {
    if (!isAdmin) return;
    const original = polls.find(p => p.id === pollId);
    if (!original) return;

    const copy = {
      id: crypto.randomUUID(),
      question: original.question,
      className: original.className || null,
      options: original.options.map(o => ({ text: o.text, votes: 0 })),
      status: 'draft',
      correctIndex: original.correctIndex,
      revealed: false,
      voters: new Set()
    };
    const originalIndex = polls.findIndex(p => p.id === pollId);
    polls.splice(originalIndex + 1, 0, copy);
    broadcastAdminState();
  });

  socket.on('admin:deletePoll', (pollId) => {
    if (!isAdmin) return;
    polls = polls.filter(p => p.id !== pollId);
    if (activePollId === pollId) activePollId = null;
    broadcastState();
    broadcastAdminState();
  });

  socket.on('vote', ({ pollId, optionIndex, clientId }) => {
    const poll = polls.find(p => p.id === pollId);
    if (!poll || poll.status !== 'open') return;
    if (!clientId || typeof optionIndex !== 'number') return;
    if (poll.voters.has(clientId)) return;
    if (optionIndex < 0 || optionIndex >= poll.options.length) return;

    poll.voters.add(clientId);
    poll.options[optionIndex].votes += 1;
    broadcastState();
    broadcastAdminState();
  });
});

server.listen(PORT, () => {
  console.log(`Live Polling server running on port ${PORT}`);
});
