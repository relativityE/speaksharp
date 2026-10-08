"""Copy the newest prior board database safely. Never overwrite an installed target."""
from pathlib import Path
import shutil
import sqlite3


def migrate_state(app):
    app = Path(app)
    target = app / '.agent-work' / 'state.db'
    if target.exists():
        return None
    candidates = [p for p in app.parent.glob('rwt-pr-handoff-v*/.agent-work/state.db')
                  if p.resolve() != target.resolve()]
    if not candidates:
        return None
    source = max(candidates, key=lambda p: max(p.stat().st_mtime,
                     Path(str(p)+'-wal').stat().st_mtime if Path(str(p)+'-wal').exists() else 0))
    target.parent.mkdir(parents=True, exist_ok=True)
    # SQLite backup includes committed WAL pages; copying only state.db can lose recent updates.
    with sqlite3.connect(f'{source.resolve().as_uri()}?mode=ro', uri=True) as src:
        with sqlite3.connect(target) as dst:
            src.backup(dst)
    old_uploads = source.parent.parent / 'uploads'
    if old_uploads.exists() and not (app / 'uploads').exists():
        shutil.copytree(old_uploads, app / 'uploads')
    return source


if __name__ == '__main__':
    source = migrate_state(Path(__file__).resolve().parent)
    print(f'Migrated board history from {source.parent.parent.name}' if source else
          'Using existing board state or starting a fresh board')
