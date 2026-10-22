import hashlib
import json
from pathlib import Path

ROOT = Path('/private/tmp/speaksharp-cli-smol-profile-20261021')
SUPPORT = Path('/Users/fibonacci/SW_Dev/delivery-support/cli-smol-receiving-20261022')
CACHE = Path('/private/tmp/speaksharp-model-assets-1304')
MANIFEST = Path('/Users/fibonacci/SW_Dev/delivery-support/cli-smol-diagnostic-wiring-20261022/assets-manifest.json')
PROFILE = Path('/private/tmp/speaksharp-eval-owned-smol-20261022T2330')
OUTPUT = Path('/private/tmp/cli-smol-minimum-smoke-20261022T2330.json')

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def require(condition, reason):
    if not condition:
        raise SystemExit('PREFLIGHT_REFUSED: ' + reason)

require(Path.cwd().resolve() == ROOT, 'wrong current directory')
review_path = SUPPORT / 'review-manifest.json'
require(digest(review_path) == '700c52dfd1df5d75f077bd5cad42aa4832a93fc0ff21564616ed74c84479dc8f', 'accepted review manifest drift')
review = json.loads(review_path.read_text())
for item in review['sourceFiles']:
    require(digest(ROOT / item['name']) == item['sha256'], 'source drift: ' + item['name'])
for item in review['dependencies']['dependencies']:
    require(digest(ROOT / item['path']) == item['sha256'], 'dependency drift: ' + item['path'])
for name, expected in review['dependencies']['installedVersions'].items():
    observed = json.loads((ROOT / 'node_modules' / name / 'package.json').read_text())['version']
    require(observed == expected, 'installed version drift: ' + name)
require(digest(MANIFEST) == '13e3c3e6b2729239d46c12cdfd4e84c1448e0a1532fb6cb3048a0692de893cf5', 'asset manifest drift')
assets = json.loads(MANIFEST.read_text())['assets']
require(len(assets) == 45 and sum(a['bytes'] for a in assets) == 972833253, 'unexpected asset population')
for asset in assets:
    require(asset['group'] in ('smollm2', 'smollm2-runtime'), 'unexpected model group')
    path = CACHE / Path(asset['path']).name if asset['group'] == 'smollm2-runtime' else CACHE / asset['group'] / asset['path']
    require(path.stat().st_size == asset['bytes'], 'asset size mismatch: ' + str(path))
    require(digest(path) == asset['verified_sha256'], 'asset hash mismatch: ' + str(path))
for path in (PROFILE, OUTPUT, Path(str(OUTPUT) + '.manifest.json'), Path(str(OUTPUT) + '.pending')):
    require(not path.exists() and not path.is_symlink(), 'profile/output already exists: ' + str(path))
print(json.dumps({'status': 'PREFLIGHT_PASS', 'sourceFiles': 7, 'verifiedAssets': 45,
                  'verifiedAssetBytes': 972833253, 'modelCalls': 0,
                  'profile': str(PROFILE), 'output': str(OUTPUT),
                  'remainingGuards': 'Fresh interlock, memory admission and real GPU checked by the runner; supported ordinary-Terminal route required.'}))
