"""Verify a commit-pinned package before invoking its launcher."""
import hashlib
import json
from pathlib import Path


def verify(root):
    root = Path(root).resolve()
    try:
        manifest = json.loads((root / 'PACKAGE-MANIFEST.json').read_text())
        entries = manifest['files']
        if not isinstance(entries, list) or not entries:
            raise ValueError('empty file list')
        seen = set()
        for entry in entries:
            rel = Path(entry['path'])
            if rel.is_absolute() or '..' in rel.parts or entry['path'] in seen:
                raise ValueError('unsafe or duplicate package path')
            seen.add(entry['path'])
            path = root / rel
            if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
                raise ValueError('missing or redirected package file: ' + entry['path'])
            data = path.read_bytes()
            if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
                raise ValueError('package mismatch: ' + entry['path'])
        for path in root.rglob('*'):
            if '.agent-work' in path.parts or '__pycache__' in path.parts:
                continue
            if path.suffix in ('.py', '.sh', '.command', '.html', '.cjs', '.js') and path.relative_to(root).as_posix() not in seen:
                raise ValueError('unlisted executable source: ' + path.relative_to(root).as_posix())
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return [str(exc)]
    return []
