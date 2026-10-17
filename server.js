const express = require('express'), initSqlJs = require('sql.js'), fs = require('fs'), path = require('path'),
  bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), crypto = require('crypto'),
  helmet = require('helmet'), rate = require('express-rate-limit'), cookies = require('cookie-parser');

const prod = process.env.NODE_ENV === 'production';
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) { console.error('Defina JWT_SECRET (16+ caracteres).'); process.exit(1); }

const TZ = '-03:00';
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const DEFAULTS = {
  studio_name: 'Studio Agatha Beauty', whatsapp: '5511965126344', instagram: 'studio_agathaa_',
  address: 'Avenida Monte Alegre, 722, Soberana, Guarulhos/SP', hours_text: '', map_url: '',
  min_notice_hours: '2', max_days_ahead: '30', cancel_hours: '24', slot_step_min: '30',
};
const PUBLIC_KEYS = ['studio_name', 'whatsapp', 'instagram', 'address', 'hours_text', 'map_url', 'max_days_ahead', 'cancel_hours'];

// sql.js
const dbFile = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'agathaa.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
let db, SQL;

const initDb = async () => {
  if (!SQL) SQL = await initSqlJs();
  let data; try { data = fs.readFileSync(dbFile); } catch { data = null; }
  db = new SQL.Database(data);
  db.run('PRAGMA foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  db.run(schema);  // executar tudo de uma vez
  saveDb();
};
const saveDb = () => { fs.writeFileSync(dbFile, Buffer.from(db.export())); };
const dbRun = (sql, p) => {
  const st = db.prepare(sql.replace(/\$(\d+)/g, (m, n) => '?' + n));
  const a = (p || []).map(v => v instanceof Date ? v.toISOString() : typeof v === 'boolean' ? +v : Number.isNaN(v) ? null : v);
  try {
    st.bind(a);
    const isRead = /^\s*(select|with)\b/i.test(sql);
    if (isRead) {
      const rows = []; while (st.step()) rows.push(st.getAsObject()); st.free(); return { rows, rowCount: rows.length };
    }
    st.step(); st.free(); return { rows: [], rowCount: db.getRowsModified() };
  } catch (e) { st.free(); if (/overlap|UNIQUE|CHECK/.test(e.message)) e.code = 'SQLITE_CONSTRAINT'; throw e; }
};
const pool = { query: async (sql, p) => dbRun(sql, p) };

async function getSettings(c = pool) {
  const r = await c.query('SELECT key, value FROM settings');
  return { ...DEFAULTS, ...Object.fromEntries(r.rows.map(x => [x.key, x.value])) };
}

async function freeSlots(c, { pid, sid, date }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { slots: [] };
  const S = await getSettings(c);
  const sv = (await c.query('SELECT * FROM services WHERE id=?1 AND active', [sid])).rows[0];
  const ok = sv && (await c.query(
    `SELECT 1 FROM professional_services ps JOIN professionals p ON p.id=ps.professional_id
     WHERE ps.professional_id=?1 AND ps.service_id=?2 AND p.active`, [pid, sid])).rowCount;
  if (!ok) return { slots: [] };
  const noon = new Date(`${date}T12:00:00${TZ}`);
  if (isNaN(noon)) return { slots: [] };
  const now = Date.now(), min = now + Number(S.min_notice_hours) * 3600e3, max = now + Number(S.max_days_ahead) * 864e5;
  const wh = (await c.query('SELECT start_time, end_time FROM working_hours WHERE professional_id=?1 AND weekday=?2',
    [pid, noon.getUTCDay()])).rows;
  const from = new Date(`${date}T00:00:00${TZ}`), to = new Date(from.getTime() + 864e5);
  const busy = (await c.query(
    `SELECT starts_at s, ends_at e FROM appointments WHERE professional_id=?1 AND status IN ('confirmed','completed') AND starts_at<?3 AND ends_at>?2
     UNION ALL SELECT starts_at, ends_at FROM schedule_blocks WHERE professional_id=?1 AND starts_at<?3 AND ends_at>?2`,
    [pid, from, to])).rows;
  const slots = [], step = Number(S.slot_step_min) || 30;
  for (const w of wh) {
    const [sh, sm] = w.start_time.split(':'), [eh, em] = w.end_time.split(':');
    for (let t = +sh * 60 + +sm; t + sv.duration_min <= +eh * 60 + +em; t += step) {
      const st = new Date(`${date}T${hhmm(t)}:00${TZ}`), en = new Date(st.getTime() + sv.duration_min * 6e4);
      if (st < min || st > max) continue;
      if (busy.some(b => new Date(b.s) < en && new Date(b.e) > st)) continue;
      slots.push(hhmm(t));
    }
  }
  return { slots, service: sv };
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '50kb' }));
app.use(cookies());
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e.message); res.status(500).json({ error: 'Erro interno. Tente novamente.' }); });

app.get('/healthz', (_, res) => res.send('ok'));

app.get('/api/public', wrap(async (_, res) => {
  const S = await getSettings();
  const services = (await pool.query(
    `SELECT s.id, s.category, s.name, s.description, s.price_cents, s.duration_min FROM services s
     WHERE s.active AND EXISTS (SELECT 1 FROM professional_services ps JOIN professionals p ON p.id=ps.professional_id WHERE ps.service_id=s.id AND p.active)
     ORDER BY s.category, s.name`)).rows;
  res.json({ settings: Object.fromEntries(PUBLIC_KEYS.map(k => [k, S[k]])), services });
}));

app.get('/api/professionals', wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT p.id, p.name, p.bio FROM professionals p JOIN professional_services ps ON ps.professional_id=p.id
     WHERE p.active AND ps.service_id=?1 ORDER BY p.name`, [Number(req.query.service) || 0]);
  res.json(r.rows);
}));

app.get('/api/team', wrap(async (_, res) => res.json((await pool.query(
  `SELECT p.id, p.name, p.bio FROM professionals p WHERE p.active AND EXISTS (SELECT 1 FROM professional_services ps WHERE ps.professional_id=p.id) ORDER BY p.name`)).rows)));

app.get('/api/slots', wrap(async (req, res) => {
  const { slots } = await freeSlots(pool, { pid: Number(req.query.pro), sid: Number(req.query.service), date: req.query.date });
  res.json({ slots });
}));

app.get('/api/gallery', (_, res) => {
  const dir = path.join(__dirname, 'public', 'gallery');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { }
  res.json(files.filter(f => /\.(jpe?g|png|webp)$/i.test(f)).map(f => '/gallery/' + f));
});

const bookLimit = rate({ windowMs: 15 * 60e3, max: 20, standardHeaders: true, legacyHeaders: false });
app.post('/api/book', bookLimit, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true });
  const name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase();
  const phone = String(b.phone || '').replace(/\D/g, '');
  if (name.length < 2 || name.length > 80 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.length < 10 || phone.length > 13)
    return res.status(400).json({ error: 'Confira nome, WhatsApp (com DDD) e e-mail.' });
  const pid = Number(b.professional), sid = Number(b.service), date = String(b.date || ''), time = String(b.time || '');
  if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Horário inválido.' });
  const token = crypto.randomBytes(32).toString('hex');
  try {
    const { slots, service } = await freeSlots(pool, { pid, sid, date });
    if (!slots.includes(time)) return res.status(409).json({ error: 'Esse horário não está mais disponível. Escolha outro.' });
    const st = new Date(`${date}T${time}:00${TZ}`), en = new Date(st.getTime() + service.duration_min * 6e4);
    const r = await pool.query(
      `INSERT INTO appointments (professional_id, service_id, customer_name, customer_phone, customer_email, starts_at, ends_at, price_cents, duration_min, token_hash)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) RETURNING id`,
      [pid, sid, name, phone, email, st, en, service.price_cents, service.duration_min, sha(token)]);
    if (r.rows.length) {
      await pool.query(`INSERT INTO notification_outbox (appointment_id, channel, kind) VALUES (?1,'email','confirmation'),(?1,'whatsapp','confirmation')`, [r.rows[0].id]);
      saveDb();
      res.status(201).json({ ok: true, manage_url: `/m/${token}` });
    } else throw new Error('Falha ao inserir');
  } catch (e) {
    if (/overlap|UNIQUE constraint|SQLITE_CONSTRAINT/.test(e.message)) return res.status(409).json({ error: 'Esse horário acabou de ser reservado. Escolha outro.' });
    throw e;
  }
}));

const getByToken = async token => (await pool.query(
  `SELECT a.id, a.status, a.starts_at, a.price_cents, a.duration_min, a.customer_name, s.name service, p.name professional
   FROM appointments a JOIN services s ON s.id=a.service_id JOIN professionals p ON p.id=a.professional_id WHERE a.token_hash=?1`, [sha(token)])).rows[0];
app.get('/api/manage/:token', rate({ windowMs: 60e3, max: 30 }), wrap(async (req, res) => {
  const a = await getByToken(req.params.token);
  a ? res.json(a) : res.status(404).json({ error: 'Reserva não encontrada.' });
}));
app.post('/api/manage/:token/cancel', rate({ windowMs: 60e3, max: 10 }), wrap(async (req, res) => {
  const a = await getByToken(req.params.token);
  if (!a) return res.status(404).json({ error: 'Reserva não encontrada.' });
  const S = await getSettings();
  if (a.status !== 'confirmed') return res.status(400).json({ error: 'Esta reserva não pode mais ser cancelada.' });
  if (new Date(a.starts_at).getTime() - Date.now() < Number(S.cancel_hours) * 3600e3)
    return res.status(400).json({ error: `Cancelamento online só com ${S.cancel_hours}h de antecedência. Fale com o estúdio pelo WhatsApp.` });
  await pool.query(`UPDATE appointments SET status='cancelled' WHERE id=?1`, [a.id]);
  saveDb();
  res.json({ ok: true });
}));

app.post('/api/admin/login', rate({ windowMs: 15 * 60e3, max: 10 }), wrap(async (req, res) => {
  const u = (await pool.query('SELECT * FROM users WHERE email=?1', [String(req.body.email || '').toLowerCase()])).rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  res.cookie('sa', jwt.sign({ id: u.id, role: u.role, pid: u.professional_id }, SECRET, { expiresIn: '8h' }),
    { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: 8 * 3600e3 });
  res.json({ role: u.role });
}));
app.post('/api/admin/logout', (_, res) => { res.clearCookie('sa'); res.json({ ok: true }); });

const auth = (...roles) => (req, res, next) => {
  try {
    const u = jwt.verify(req.cookies.sa, SECRET);
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'Sem permissão.' });
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Faça login.' }); }
};
const audit = (u, action, detail) => pool.query('INSERT INTO audit_logs (user_id, action, detail) VALUES (?1,?2,?3)', [u.id, action, detail]).then(() => saveDb()).catch(() => {});
const staff = auth('owner', 'admin'), any = auth();

app.get('/api/admin/appointments', any, wrap(async (req, res) => {
  const own = req.user.role === 'professional';
  const since = new Date(Date.now() - 864e5);
  const r = await pool.query(
    `SELECT a.id, a.status, a.starts_at, a.price_cents, a.customer_name, a.customer_phone, s.name service, p.name professional
     FROM appointments a JOIN services s ON s.id=a.service_id JOIN professionals p ON p.id=a.professional_id
     WHERE a.starts_at >= ?1 ${own ? 'AND a.professional_id=?2' : ''} ORDER BY a.starts_at LIMIT 300`,
    own ? [since, req.user.pid] : [since]);
  res.json(r.rows);
}));
app.patch('/api/admin/appointments/:id', any, wrap(async (req, res) => {
  const st = req.body.status;
  if (!['confirmed', 'cancelled', 'completed', 'no_show'].includes(st)) return res.status(400).json({ error: 'Status inválido.' });
  const own = req.user.role === 'professional';
  try {
    const r = await pool.query(`UPDATE appointments SET status=?1 WHERE id=?2 ${own ? 'AND professional_id=?3' : ''}`,
      own ? [st, req.params.id, req.user.pid] : [st, req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Reserva não encontrada.' });
    saveDb();
  } catch (e) { if (/overlap|SQLITE_CONSTRAINT/.test(e.message)) return res.status(409).json({ error: 'Conflito de horário.' }); throw e; }
  audit(req.user, 'appointment_status', `${req.params.id}=${st}`);
  res.json({ ok: true });
}));

app.get('/api/admin/services', staff, wrap(async (_, res) => res.json((await pool.query('SELECT * FROM services ORDER BY category, name')).rows)));
const svcVals = b => [b.category, String(b.name || '').trim(), b.description || '', Math.round(Number(b.price) * 100), Number(b.duration_min), b.active !== false ? 1 : 0];
app.post('/api/admin/services', staff, wrap(async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO services (category,name,description,price_cents,duration_min,active) VALUES (?1,?2,?3,?4,?5,?6) RETURNING id', svcVals(req.body));
    if (r.rows[0]) { saveDb(); audit(req.user, 'service_create', String(r.rows[0].id)); res.status(201).json(r.rows[0]); }
  } catch (e) { if (/SQLITE_CONSTRAINT|CHECK/.test(e.message)) return res.status(400).json({ error: 'Dados do serviço inválidos.' }); throw e; }
}));
app.put('/api/admin/services/:id', staff, wrap(async (req, res) => {
  try {
    await pool.query('UPDATE services SET category=?1,name=?2,description=?3,price_cents=?4,duration_min=?5,active=?6 WHERE id=?7', [...svcVals(req.body), req.params.id]);
    saveDb(); audit(req.user, 'service_update', req.params.id); res.json({ ok: true });
  } catch (e) { if (/SQLITE_CONSTRAINT/.test(e.message)) return res.status(400).json({ error: 'Dados do serviço inválidos.' }); throw e; }
}));

app.get('/api/admin/professionals', staff, wrap(async (_, res) => res.json((await pool.query(
  `SELECT p.id, p.name, p.bio, p.active, group_concat(ps.service_id) ids FROM professionals p
   LEFT JOIN professional_services ps ON ps.professional_id=p.id GROUP BY p.id ORDER BY p.name`)).rows
  .map(r => ({ ...r, active: !!r.active, service_ids: r.ids ? r.ids.split(',').map(Number) : [] })))));
app.post('/api/admin/professionals', staff, wrap(async (req, res) => {
  const { name, bio, service_ids = [], weekdays = [], start, end } = req.body;
  if (!name || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) return res.status(400).json({ error: 'Confira nome e horários.' });
  try {
    const id = (await pool.query('INSERT INTO professionals (name,bio) VALUES (?1,?2) RETURNING id', [name, bio || ''])).rows[0]?.id;
    for (const s of service_ids) await pool.query('INSERT INTO professional_services VALUES (?1,?2)', [id, Number(s)]);
    for (const d of weekdays) await pool.query('INSERT INTO working_hours (professional_id,weekday,start_time,end_time) VALUES (?1,?2,?3,?4)', [id, Number(d), start, end]);
    saveDb(); audit(req.user, 'professional_create', String(id)); res.status(201).json({ id });
  } catch (e) { throw e; }
}));

app.get('/api/admin/settings', staff, wrap(async (_, res) => res.json(await getSettings())));
app.put('/api/admin/settings', auth('owner'), wrap(async (req, res) => {
  for (const k of Object.keys(DEFAULTS)) if (k in req.body) await pool.query(
    'INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, String(req.body[k]).slice(0, 300)]);
  saveDb(); audit(req.user, 'settings_update', ''); res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/m/:token', (_, res) => res.sendFile(path.join(__dirname, 'public', 'manage.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

async function init() {
  const u = (await pool.query('SELECT 1 FROM users LIMIT 1')).rowCount;
  if (!u) {
    const { OWNER_EMAIL: e, OWNER_PASSWORD: p } = process.env;
    if (e && p && p.length >= 12) {
      await pool.query(`INSERT INTO users (email,password_hash,role) VALUES (?1,?2,'owner')`, [e.toLowerCase(), await bcrypt.hash(p, 12)]);
      saveDb();
      console.log('✓ Conta da proprietária criada.');
    } else console.warn('⚠ Defina OWNER_EMAIL e OWNER_PASSWORD (12+ caracteres) para criar a conta da proprietária.');
  }
}

(async () => {
  try {
    await initDb();
    await init();
    app.listen(process.env.PORT || 3000, () => console.log('🎨 Studio Agathaa no ar'));
  } catch (e) {
    console.error('Erro:', e);
    process.exit(1);
  }
})();
