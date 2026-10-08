"""Stage and verify prior board state plus packet artifacts before importing it."""
from pathlib import Path
from contextlib import closing
import hashlib
import json
import os
import shutil
import sqlite3
import uuid


def _tree_manifest(root):
    root = Path(root)
    entries = []
    if not root.exists():
        return entries
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            entries.append({'path': rel, 'type': 'symlink', 'target': os.readlink(path)})
        elif path.is_file():
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(block)
            entries.append({'path': rel, 'type': 'file', 'sha256': digest.hexdigest(), 'size': path.stat().st_size})
    return entries


def _rewrite_artifact_paths(db, old_root, new_root):
    if not db.exists():
        return
    old_root = str(Path(old_root).absolute())
    new_root = str(Path(new_root).absolute())
    with sqlite3.connect(db) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'attachments' not in tables:
            return
        columns = {row[1] for row in connection.execute('PRAGMA table_info(attachments)')}
        if not {'id', 'path'} <= columns:
            return
        for attachment_id, old_path in connection.execute('SELECT id,path FROM attachments').fetchall():
            value = str(old_path or '')
            if value == old_root or value.startswith(old_root + os.sep):
                rebased = new_root + value[len(old_root):]
                connection.execute('UPDATE attachments SET path=? WHERE id=?', (rebased, attachment_id))


def _prepare_database_for_promotion(db):
    """Checkpoint and close the staged SQLite DB before moving its main file.

    SQLite sidecars are not promoted with the database path. A source in WAL mode can otherwise
    leave recent pages in `-wal` while the migration atomically moves only `state.db`.
    """
    connection = sqlite3.connect(db, timeout=30)
    try:
        check = connection.execute('PRAGMA integrity_check').fetchone()
        if not check or check[0] != 'ok':
            raise RuntimeError(f'Staged state database failed integrity check before promotion: {check}')
        checkpoint = connection.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
        if checkpoint and int(checkpoint[0]) != 0:
            raise RuntimeError(f'Staged state database WAL checkpoint remained busy before promotion: {checkpoint}')
        mode = connection.execute('PRAGMA journal_mode=DELETE').fetchone()
        if not mode or str(mode[0]).lower() != 'delete':
            raise RuntimeError(f'Staged state database could not leave WAL mode before promotion: {mode}')
        connection.commit()
    finally:
        connection.close()
    for suffix in ('-wal', '-shm'):
        sidecar = Path(str(db) + suffix)
        if sidecar.exists():
            if sidecar.is_symlink():
                raise RuntimeError(f'Staged SQLite sidecar is unexpectedly a symlink: {sidecar}')
            sidecar.unlink()


def _select_source(app, candidates, source):
    requested = source or os.environ.get('RWT_MIGRATE_FROM', '').strip()
    if requested:
        chosen = Path(requested).expanduser().resolve()
        matching = [candidate for candidate in candidates if candidate.resolve() == chosen]
        if not matching:
            raise ValueError(f'RWT_MIGRATE_FROM is not one of the discovered sibling state DBs: {chosen}')
        return matching[0]
    if len(candidates) > 1:
        paths = ', '.join(str(p.resolve()) for p in candidates)
        raise RuntimeError(f'Multiple prior board states found; set RWT_MIGRATE_FROM to the intended source: {paths}')
    return candidates[0] if candidates else None


def _write_receipt(target_dir, target, manifest):
    receipt = {
        'source_db': manifest['source_db'],
        'source_app': manifest['source_app'],
        'target_db': str(target),
        'db_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'artifacts': manifest['artifacts'],
        'completed': True,
    }
    temp_receipt = target_dir / f'.migration-manifest-{uuid.uuid4().hex}.tmp'
    temp_receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    os.replace(temp_receipt, target_dir / 'migration-manifest.json')


def migrate_state(app, source=None):
    app = Path(app).expanduser().absolute()
    target_dir = app / '.agent-work'
    target = target_dir / 'state.db'
    stage = app.parent / f'.{app.name}.migration-stage'
    stage_db = stage / '.agent-work' / 'state.db'
    if target.exists():
        if stage.exists():
            manifest_path = stage / 'manifest.json'
            if not manifest_path.exists() or stage_db.exists():
                raise RuntimeError(f'Target state exists while migration staging is unresolved: {stage}')
            manifest = json.loads(manifest_path.read_text())
            if hashlib.sha256(target.read_bytes()).hexdigest() != manifest.get('db_sha256'):
                raise RuntimeError(f'Existing target DB does not match staged migration manifest: {target}')
            for name in ('uploads', 'handoffs'):
                if _tree_manifest(app / name) != manifest.get('artifacts', {}).get(name, []):
                    raise RuntimeError(f'Existing target {name} does not match staged migration manifest')
            _write_receipt(target_dir, target, manifest)
            shutil.rmtree(stage)
        return None
    candidates = sorted(p for p in app.parent.glob('rwt-pr-handoff-v*/.agent-work/state.db')
                        if p.resolve() != target.resolve())
    chosen = _select_source(app, candidates, source)
    if chosen is None:
        return None

    source_app = chosen.parent.parent
    if stage.exists():
        manifest_path = stage / 'manifest.json'
        if not manifest_path.exists():
            raise RuntimeError(f'Incomplete migration staging directory needs inspection: {stage}')
        manifest = json.loads(manifest_path.read_text())
        if manifest.get('source_db') != str(chosen.resolve()):
            raise RuntimeError(f'Migration staging belongs to another source: {stage}')
    else:
        stage.mkdir(parents=True)
        stage_db.parent.mkdir(parents=True)
        try:
            with closing(sqlite3.connect(f'{chosen.resolve().as_uri()}?mode=ro', uri=True)) as src:
                with closing(sqlite3.connect(stage_db)) as dst:
                    src.backup(dst)
                    check = dst.execute('PRAGMA integrity_check').fetchone()
                    if not check or check[0] != 'ok':
                        raise RuntimeError(f'Staged state database failed integrity check: {check}')
                    dst.commit()
            _prepare_database_for_promotion(stage_db)
            sources = {'uploads': source_app / 'uploads', 'handoffs': source_app / 'handoffs'}
            for name, old_path in sources.items():
                if old_path.exists():
                    shutil.copytree(old_path, stage / name, symlinks=True)
            _rewrite_artifact_paths(stage_db, sources['uploads'], app / 'uploads')
            _rewrite_artifact_paths(stage_db, sources['handoffs'], app / 'handoffs')
            manifest = {
                'source_db': str(chosen.resolve()),
                'source_app': str(source_app),
                'target_app': str(app),
                'artifacts': {name: _tree_manifest(stage / name) for name in ('uploads', 'handoffs')},
                'db_sha256': hashlib.sha256(stage_db.read_bytes()).hexdigest(),
            }
            (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
        except Exception:
            # Preserve the staged evidence for diagnosis; never modify the old source.
            raise

    # Promote packet artifacts first and the verified DB last. An interrupted import
    # has no target DB commit marker and can be safely resumed from this staged manifest.
    app.mkdir(parents=True, exist_ok=True)
    for name in ('uploads', 'handoffs'):
        staged = stage / name
        destination = app / name
        if not staged.exists():
            continue
        if destination.exists():
            if _tree_manifest(destination) != manifest['artifacts'].get(name, []):
                raise RuntimeError(f'Existing {name} destination conflicts with staged migration; source preserved')
        else:
            os.replace(staged, destination)
    target_dir.mkdir(parents=True, exist_ok=True)
    os.replace(stage_db, target)
    _write_receipt(target_dir, target, manifest)
    shutil.rmtree(stage)
    return chosen


if __name__ == '__main__':
    source = migrate_state(Path(__file__).resolve().parent)
    print(f'Migrated board history from {source.parent.parent.name}' if source else
          'Using existing board state or starting a fresh board')
