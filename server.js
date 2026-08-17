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
const io = new Server(server);

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
let polls = [];        // { id, question, options: [{ text, votes }], status: 'draft'|'open'|'closed', voters: Set }
let activePollId = null;

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
          options: options.map(text => ({ text, votes: 0 })),
          status: 'draft',
          voters: new Set()
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

function publicPoll(poll) {
  if (!poll) return null;
  return {
    id: poll.id,
    question: poll.question,
    status: poll.status,
    options: poll.options.map(o => ({ text: o.text, votes: o.votes })),
    totalVotes: poll.options.reduce((sum, o) => sum + o.votes, 0)
  };
}

function publicPollList() {
  return polls.map(p => ({
    id: p.id,
    question: p.question,
    status: p.status,
    options: p.options.map(o => ({ text: o.text, votes: o.votes })),
    totalVotes: p.options.reduce((sum, o) => sum + o.votes, 0)
  }));
}

function broadcastState() {
  const active = polls.find(p => p.id === activePollId) || null;
  io.emit('poll:state', publicPoll(active));
}

function broadcastAdminState(socket) {
  const target = socket ? socket : io;
  target.emit('admin:polls', publicPollList());
  const active = polls.find(p => p.id === activePollId) || null;
  target.emit('poll:state', publicPoll(active));
}

io.on('connection', (socket) => {
  let isAdmin = false;

  // Send current state to any newly connected client
  const active = polls.find(p => p.id === activePollId) || null;
  socket.emit('poll:state', publicPoll(active));
  socket.emit('brand:state', currentBrand);

  socket.on('admin:setBrand', (brand) => {
    if (!isAdmin) return;
    if (!VALID_BRANDS.has(brand)) return;
    currentBrand = brand;
    io.emit('brand:state', currentBrand);
  });

  socket.on('admin:auth', (password, cb) => {
    if (password === ADMIN_PASSWORD) {
      isAdmin = true;
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
      options: options.map(text => ({ text, votes: 0 })),
      status: 'draft',
      voters: new Set()
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
    // Tell every participant's browser to forget it already voted on this
    // poll, so a reset actually lets them vote again instead of leaving
    // them stuck on a stale "already voted" results view.
    io.emit('poll:reset', { pollId: poll.id });
    broadcastState();
    broadcastAdminState();
  });

  socket.on('admin:updatePoll', ({ pollId, question, options } = {}) => {
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
      options: original.options.map(o => ({ text: o.text, votes: 0 })),
      status: 'draft',
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
