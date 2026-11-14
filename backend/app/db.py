import os, sqlite3, threading
from pathlib import Path
from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS spaces(
  id INTEGER PRIMARY KEY,              -- 25Live space id (itemId)
  short_name TEXT NOT NULL, formal_name TEXT NOT NULL,
  building TEXT, space_type TEXT,
  max_capacity INTEGER, default_capacity INTEGER,
  layouts TEXT, categories TEXT,
  table_type TEXT, table_type_source TEXT,   -- derived from layouts until feedback exists
  restricted_to TEXT,                        -- e.g. 'Heinz' for affiliate-only rooms
  has_availability INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1);          -- 0 when a space disappears from 25Live (kept so feedback survives)
CREATE TABLE IF NOT EXISTS space_features(space_id INTEGER REFERENCES spaces(id), feature TEXT, PRIMARY KEY(space_id, feature));
CREATE TABLE IF NOT EXISTS space_amenities(space_id INTEGER REFERENCES spaces(id), amenity TEXT, PRIMARY KEY(space_id, amenity));
CREATE TABLE IF NOT EXISTS busy(space_id INTEGER REFERENCES spaces(id), date TEXT, start_min INTEGER, end_min INTEGER, kind TEXT);
CREATE INDEX IF NOT EXISTS busy_idx ON busy(space_id, date);
CREATE TABLE IF NOT EXISTS availability_dates(date TEXT PRIMARY KEY, fetched_at TEXT);
CREATE TABLE IF NOT EXISTS feedback(
  id INTEGER PRIMARY KEY AUTOINCREMENT, space_id INTEGER NOT NULL REFERENCES spaces(id),
  noise INTEGER CHECK(noise BETWEEN 1 AND 3), brightness INTEGER CHECK(brightness BETWEEN 1 AND 3),
  temperature INTEGER CHECK(temperature BETWEEN 1 AND 3), table_type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
"""

def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or config.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    if "active" not in [r[1] for r in conn.execute("PRAGMA table_info(spaces)")]:   # migrate DBs created before this column
        conn.execute("ALTER TABLE spaces ADD COLUMN active INTEGER NOT NULL DEFAULT 1")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_built = False
_lock = threading.Lock()

def ensure_built() -> None:
    """Build the database from data/*.txt if it doesn't exist (e.g. a fresh Vercel instance)."""
    global _built
    if _built: return
    with _lock:
        if _built: return
        if not os.path.exists(config.DB_PATH):
            from .ingest import ingest  # local import: ingest imports this module
            conn = connect()
            try: ingest(str(DATA_DIR / "raw_pages.txt"), str(DATA_DIR / "availability.txt"), conn)
            finally: conn.close()
        _built = True

def get_db():  # FastAPI dependency
    ensure_built()
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
