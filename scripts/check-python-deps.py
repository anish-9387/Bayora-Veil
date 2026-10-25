"""Check the production Python lock against the public OSV vulnerability database."""
import json
from pathlib import Path
import urllib.request

packages = [line.split('==') for line in Path('services/target-adapter/requirements.lock').read_text().splitlines() if line and not line.startswith('#')]
assert all(len(package) == 2 for package in packages), 'The production lock must use exact versions'
request = urllib.request.Request('https://api.osv.dev/v1/querybatch',
    data=json.dumps({'queries': [{'package': {'name': name, 'ecosystem': 'PyPI'}, 'version': version} for name, version in packages]}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(request, timeout=45) as response:
    results = json.load(response)['results']
assert len(results) == len(packages), 'Incomplete vulnerability response'
vulnerable = [(packages[index][0], [item['id'] for item in result.get('vulns', [])]) for index, result in enumerate(results) if result.get('vulns')]
if vulnerable:
    raise SystemExit('Known advisories: ' + json.dumps(vulnerable))
print(f'OSV: no known advisories for {len(packages)} pinned Python packages')
