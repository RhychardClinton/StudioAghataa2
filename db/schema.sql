CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS professionals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, bio TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'professional' CHECK (role IN ('owner','admin','professional')),
  professional_id INTEGER REFERENCES professionals(id));
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL CHECK (category IN ('Nails','Lashes')),
  name TEXT NOT NULL, description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0), duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS professional_services (
  professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, service_id));
CREATE TABLE IF NOT EXISTS working_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT, professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  CHECK (end_time > start_time));
CREATE TABLE IF NOT EXISTS schedule_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, reason TEXT, CHECK (ends_at > starts_at));
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  professional_id INTEGER NOT NULL REFERENCES professionals(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, customer_email TEXT NOT NULL,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,   -- ISO UTC
  price_cents INTEGER NOT NULL, duration_min INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed','no_show')),
  token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (ends_at > starts_at));
CREATE INDEX IF NOT EXISTS appt_start_idx ON appointments (starts_at);
CREATE TRIGGER IF NOT EXISTS no_overlap_ins BEFORE INSERT ON appointments
WHEN NEW.status IN ('confirmed','completed') AND EXISTS (
  SELECT 1 FROM appointments a WHERE a.professional_id = NEW.professional_id AND a.status IN ('confirmed','completed')
  AND a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at)
BEGIN SELECT RAISE(ABORT, 'overlap'); END;
CREATE TRIGGER IF NOT EXISTS no_overlap_upd BEFORE UPDATE OF status, starts_at, ends_at ON appointments
WHEN NEW.status IN ('confirmed','completed') AND EXISTS (
  SELECT 1 FROM appointments a WHERE a.id <> NEW.id AND a.professional_id = NEW.professional_id AND a.status IN ('confirmed','completed')
  AND a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at)
BEGIN SELECT RAISE(ABORT, 'overlap'); END;
CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, appointment_id INTEGER REFERENCES appointments(id), channel TEXT NOT NULL,
  kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE (appointment_id, channel, kind));
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
