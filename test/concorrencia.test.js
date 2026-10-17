// npm test  — usa SQLite em memória
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const Database = require('better-sqlite3');
const mk = () => { const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); db.exec(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  db.exec(`INSERT INTO professionals (name) VALUES ('T'); INSERT INTO services (category,name,price_cents,duration_min) VALUES ('Nails','T',1000,60);`); return db; };
const ins = (db, tok, s = '2030-01-01T12:00:00.000Z', e = '2030-01-01T13:00:00.000Z') => db.prepare(
  `INSERT INTO appointments (professional_id,service_id,customer_name,customer_phone,customer_email,starts_at,ends_at,price_cents,duration_min,token_hash)
   VALUES (1,1,'a','11999999999','a@a.com',?1,?2,1000,60,?3) RETURNING id`).all(s, e, tok);
test('reserva sobreposta é rejeitada pelo banco', () => {
  const db = mk(); ins(db, 't1');
  assert.throws(() => ins(db, 't2', '2030-01-01T12:30:00.000Z', '2030-01-01T13:30:00.000Z'), /overlap/);
  assert.doesNotThrow(() => ins(db, 't3', '2030-01-01T13:00:00.000Z', '2030-01-01T14:00:00.000Z'));
});
test('horário de reserva cancelada pode ser reutilizado', () => {
  const db = mk(); ins(db, 't1'); db.prepare(`UPDATE appointments SET status='cancelled'`).run();
  assert.doesNotThrow(() => ins(db, 't2'));
});
test('reativar reserva em horário ocupado é rejeitado', () => {
  const db = mk(); ins(db, 't1'); db.prepare(`UPDATE appointments SET status='cancelled'`).run(); ins(db, 't2');
  assert.throws(() => db.prepare(`UPDATE appointments SET status='confirmed' WHERE token_hash='t1'`).run(), /overlap/);
});
