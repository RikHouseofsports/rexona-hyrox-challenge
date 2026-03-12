'use strict';

// Load .env in development
if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
// Built-in SQLite — no native compilation needed (Node.js >= 22.5)
const { DatabaseSync } = require('node:sqlite');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const path = require('path');

// ─────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './challenge.db';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
const IS_PROD = process.env.NODE_ENV === 'production';

if (!process.env.ADMIN_PASSWORD || !process.env.EXPORT_PASSWORD) {
  console.error('ERROR: ADMIN_PASSWORD and EXPORT_PASSWORD environment variables are required.');
  process.exit(1);
}

// ─────────────────────────────────────────────
// Hash passwords at startup (never stored to disk)
// ─────────────────────────────────────────────
const ADMIN_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
const EXPORT_HASH = bcrypt.hashSync(process.env.EXPORT_PASSWORD, 12);

// ─────────────────────────────────────────────
// Database (node:sqlite — built into Node >= 22.5)
// ─────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS participants (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    voornaam       TEXT NOT NULL,
    achternaam     TEXT NOT NULL,
    email          TEXT NOT NULL,
    nationaliteit  TEXT NOT NULL DEFAULT 'Onbekend',
    opt_in         INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scores (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL,
    geslacht       TEXT NOT NULL CHECK(geslacht IN ('Man','Vrouw')),
    score_meters   INTEGER NOT NULL,
    event_naam     TEXT NOT NULL CHECK(event_naam IN ('Mechelen','Rotterdam','Heerenveen')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
  );
`);

// Migration: add nationaliteit column to existing databases
try {
  db.exec(`ALTER TABLE participants ADD COLUMN nationaliteit TEXT NOT NULL DEFAULT 'Onbekend'`);
} catch (e) { /* column already exists */ }

// All prepared statements — no string concatenation of user values anywhere
const stmts = {
  insertParticipant: db.prepare(
    `INSERT INTO participants (voornaam, achternaam, email, nationaliteit, opt_in) VALUES (?, ?, ?, ?, ?)`
  ),
  insertScore: db.prepare(
    `INSERT INTO scores (participant_id, geslacht, score_meters, event_naam) VALUES (?, ?, ?, ?)`
  ),
  getTodayScores: db.prepare(`
    SELECT s.id, p.voornaam, p.achternaam, p.nationaliteit, s.geslacht, s.score_meters, s.event_naam,
           strftime('%H:%M', s.created_at) AS tijd
    FROM scores s
    JOIN participants p ON s.participant_id = p.id
    WHERE date(s.created_at) = date('now')
    ORDER BY s.created_at DESC
  `),
  getLeaderboardMen: db.prepare(`
    SELECT s.id,
           p.voornaam || ' ' || substr(p.achternaam, 1, 1) || '.' AS naam,
           p.nationaliteit,
           s.score_meters
    FROM scores s
    JOIN participants p ON s.participant_id = p.id
    WHERE s.geslacht = 'Man'
    ORDER BY s.score_meters DESC
    LIMIT 10
  `),
  getLeaderboardWomen: db.prepare(`
    SELECT s.id,
           p.voornaam || ' ' || substr(p.achternaam, 1, 1) || '.' AS naam,
           p.nationaliteit,
           s.score_meters
    FROM scores s
    JOIN participants p ON s.participant_id = p.id
    WHERE s.geslacht = 'Vrouw'
    ORDER BY s.score_meters DESC
    LIMIT 10
  `),
  getScoreById: db.prepare(`SELECT id FROM scores WHERE id = ?`),
  updateScore: db.prepare(`UPDATE scores SET score_meters = ? WHERE id = ?`),
  deleteScore: db.prepare(`DELETE FROM scores WHERE id = ?`),
};

// Atomic register: insert participant + score in one transaction
function registerTransaction(data) {
  db.exec('BEGIN');
  try {
    const p = stmts.insertParticipant.run(
      data.voornaam, data.achternaam, data.email, data.nationaliteit, data.opt_in
    );
    stmts.insertScore.run(
      p.lastInsertRowid, data.geslacht, data.score_meters, data.event_naam
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ─────────────────────────────────────────────
// Express app
// ─────────────────────────────────────────────
const app = express();
const httpServer = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PROD,
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    sameSite: 'lax',
  },
}));

// Trust Railway's reverse proxy so req.ip reflects the real client IP
app.set('trust proxy', 1);

// ─────────────────────────────────────────────
// Rate limiter (shared for both login endpoints)
// ─────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const base = req.path.startsWith('/export') ? '/export/login' : '/admin/login';
    if (req.accepts('html')) return res.redirect(`${base}?error=blocked`);
    res.status(429).json({ error: 'Te veel inlogpogingen. Probeer het later opnieuw.' });
  },
});

// ─────────────────────────────────────────────
// Auth middleware
// ─────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminAuthenticated === true) return next();
  res.redirect('/admin/login');
}

function requireExport(req, res, next) {
  if (req.session && req.session.exportAuthenticated === true) return next();
  res.redirect('/export/login');
}

// ─────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────
const VALID_NATIONALITIES = new Set([
  'Nederland','België','Duitsland','Groot-Brittannië',
  'Australië','Canada','Denemarken','Finland','Frankrijk','Griekenland',
  'Hongarije','Ierland','Italië','Japan','Kroatië','Letland','Litouwen',
  'Luxemburg','Mexico','Nieuw-Zeeland','Noorwegen','Oekraïne','Oostenrijk',
  'Polen','Portugal','Roemenië','Rusland','Singapore','Slovenië','Slowakije',
  'Spanje','Tsjechië','Turkije','USA','Zweden','Zwitserland','Zuid-Afrika','Zuid-Korea',
]);

function validateRegistration(body) {
  const errors = [];
  const VALID_EVENTS = ['Mechelen', 'Rotterdam', 'Heerenveen'];

  const voornaam      = typeof body.voornaam      === 'string' ? body.voornaam.trim()      : '';
  const achternaam    = typeof body.achternaam    === 'string' ? body.achternaam.trim()    : '';
  const email         = typeof body.email         === 'string' ? body.email.trim()         : '';
  const nationaliteit = typeof body.nationaliteit === 'string' ? body.nationaliteit.trim() : '';

  if (voornaam.length < 1 || voornaam.length > 50)
    errors.push('Voornaam is verplicht (max 50 tekens).');
  if (achternaam.length < 1 || achternaam.length > 50)
    errors.push('Achternaam is verplicht (max 50 tekens).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push('Geldig e-mailadres is verplicht.');
  if (!['Man', 'Vrouw'].includes(body.geslacht))
    errors.push('Geslacht moet Man of Vrouw zijn.');
  if (!VALID_NATIONALITIES.has(nationaliteit))
    errors.push('Selecteer een geldig land.');

  const score = parseInt(body.score_meters, 10);
  if (isNaN(score) || score < 0 || score > 9999)
    errors.push('Score moet een getal zijn tussen 0 en 9999.');

  if (!VALID_EVENTS.includes(body.event_naam))
    errors.push('Ongeldig evenement geselecteerd.');

  if (body.opt_in !== 'on' && body.opt_in !== true && body.opt_in !== '1')
    errors.push('Akkoord met de voorwaarden is verplicht.');

  return {
    errors,
    data: {
      voornaam,
      achternaam,
      email,
      nationaliteit,
      geslacht:     body.geslacht,
      score_meters: isNaN(score) ? 0 : score,
      event_naam:   body.event_naam,
      opt_in:       errors.length === 0 ? 1 : 0,
    },
  };
}

// ─────────────────────────────────────────────
// WebSocket server
// ─────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

function broadcastLeaderboardUpdate() {
  const payload = JSON.stringify({
    type: 'leaderboard_update',
    men:   stmts.getLeaderboardMen.all(),
    women: stmts.getLeaderboardWomen.all(),
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Send current leaderboard immediately on connect
  try {
    ws.send(JSON.stringify({
      type:  'leaderboard_update',
      men:   stmts.getLeaderboardMen.all(),
      women: stmts.getLeaderboardWomen.all(),
    }));
  } catch (e) { /* ignore */ }
});

// Heartbeat to clean up stale connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeatInterval));

// ─────────────────────────────────────────────
// Routes — Admin
// ─────────────────────────────────────────────

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.post('/admin/login', loginLimiter, (req, res) => {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const valid = bcrypt.compareSync(password, ADMIN_HASH);
  if (valid) {
    req.session.adminAuthenticated = true;
    req.session.save(() => res.redirect('/admin'));
  } else {
    res.redirect('/admin/login?error=1');
  }
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/today', requireAdmin, (req, res) => {
  try {
    res.json(stmts.getTodayScores.all());
  } catch (err) {
    console.error('Error fetching today scores:', err);
    res.status(500).json({ error: 'Databasefout.' });
  }
});

app.post('/api/admin/register', requireAdmin, (req, res) => {
  const { errors, data } = validateRegistration(req.body);
  if (errors.length > 0) return res.status(400).json({ errors });

  try {
    registerTransaction(data);
    broadcastLeaderboardUpdate();
    res.status(201).json({ success: true, message: 'Deelnemer succesvol geregistreerd.' });
  } catch (err) {
    console.error('Error registering participant:', err);
    res.status(500).json({ error: 'Registratie mislukt. Probeer opnieuw.' });
  }
});

app.put('/api/admin/score/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return res.status(400).json({ error: 'Ongeldig ID.' });

  const score = parseInt(req.body.score_meters, 10);
  if (isNaN(score) || score < 0 || score > 9999)
    return res.status(400).json({ error: 'Score moet tussen 0 en 9999 zijn.' });

  const row = stmts.getScoreById.get(id);
  if (!row) return res.status(404).json({ error: 'Score niet gevonden.' });

  stmts.updateScore.run(score, id);
  broadcastLeaderboardUpdate();
  res.json({ success: true });
});

app.delete('/api/admin/score/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return res.status(400).json({ error: 'Ongeldig ID.' });

  const row = stmts.getScoreById.get(id);
  if (!row) return res.status(404).json({ error: 'Score niet gevonden.' });

  stmts.deleteScore.run(id);
  broadcastLeaderboardUpdate();
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// Routes — Leaderboard (public)
// ─────────────────────────────────────────────

app.get('/leaderboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'leaderboard.html'));
});

app.get('/api/leaderboard', (req, res) => {
  res.json({
    men:   stmts.getLeaderboardMen.all(),
    women: stmts.getLeaderboardWomen.all(),
  });
});

// ─────────────────────────────────────────────
// Routes — Export
// ─────────────────────────────────────────────

app.get('/export/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'export-login.html'));
});

app.post('/export/login', loginLimiter, (req, res) => {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const valid = bcrypt.compareSync(password, EXPORT_HASH);
  if (valid) {
    req.session.exportAuthenticated = true;
    req.session.save(() => res.redirect('/export'));
  } else {
    res.redirect('/export/login?error=1');
  }
});

app.post('/export/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/export/login'));
});

app.get('/export', requireExport, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'export.html'));
});

// Build filtered export query (values always bound as params, never concatenated)
function getExportRows(query) {
  const { event, date, geslacht } = query;
  let sql = `
    SELECT p.voornaam, p.achternaam, p.email, p.nationaliteit, s.geslacht,
           s.score_meters, s.event_naam,
           strftime('%Y-%m-%d', s.created_at) AS datum,
           p.opt_in
    FROM participants p
    JOIN scores s ON s.participant_id = p.id
    WHERE 1=1
  `;
  const params = [];

  if (event && ['Mechelen', 'Rotterdam', 'Heerenveen'].includes(event)) {
    sql += ' AND s.event_naam = ?';
    params.push(event);
  }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    sql += ' AND date(s.created_at) = ?';
    params.push(date);
  }
  if (geslacht && ['Man', 'Vrouw'].includes(geslacht)) {
    sql += ' AND s.geslacht = ?';
    params.push(geslacht);
  }

  sql += ' ORDER BY s.created_at DESC';
  return db.prepare(sql).all(...params);
}

app.get('/api/export/data', requireExport, (req, res) => {
  try {
    res.json(getExportRows(req.query));
  } catch (err) {
    console.error('Export data error:', err);
    res.status(500).json({ error: 'Fout bij ophalen data.' });
  }
});

app.get('/api/export/csv', requireExport, (req, res) => {
  try {
    const rows = getExportRows(req.query);
    const escapeCsv = (val) =>
      `"${String(val === null || val === undefined ? '' : val).replace(/"/g, '""')}"`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rexona-hyrox-export.csv"');

    // UTF-8 BOM — critical for correct display in Dutch Excel
    let csv = '\uFEFF';
    csv += 'Voornaam,Achternaam,Email,Nationaliteit,Geslacht,Score (meters),Evenement,Datum,Opt-in\n';

    rows.forEach((row) => {
      csv += [
        escapeCsv(row.voornaam),
        escapeCsv(row.achternaam),
        escapeCsv(row.email),
        escapeCsv(row.nationaliteit),
        escapeCsv(row.geslacht),
        escapeCsv(row.score_meters),
        escapeCsv(row.event_naam),
        escapeCsv(row.datum),
        escapeCsv(row.opt_in === 1 ? 'Ja' : 'Nee'),
      ].join(',') + '\n';
    });

    res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).send('Fout bij genereren CSV.');
  }
});

// ─────────────────────────────────────────────
// Redirect root to leaderboard
// ─────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/leaderboard'));

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`Rexona x HYROX Challenge running on port ${PORT}`);
  console.log(`  Leaderboard: http://localhost:${PORT}/leaderboard`);
  console.log(`  Admin:       http://localhost:${PORT}/admin`);
  console.log(`  Export:      http://localhost:${PORT}/export`);
});
