#!/usr/bin/env python3
"""Helper: run tools/shots.mjs with lat/lon based cameras without shell-quoting pain.
usage: run_shots.py <outdir> <w> <h> <settle>   (reads shot lines from stdin:  name | lat,lon,y | lat,lon,y | fov | preset | json)"""
import subprocess, sys
LAT0, LON0 = 40.7527, -73.9772
def P(s):
    lat, lon, y = [float(v) for v in s.split(',')]
    return f'{(lon - LON0) * 84395:.0f},{y:g},{-(lat - LAT0) * 111047:.0f}'
out, w, h, settle = sys.argv[1:5]
shots = []
for line in sys.stdin:
    if not line.strip(): continue
    f = [x.strip() for x in line.split('|')]
    spec = f'{f[0]}@{P(f[1])}@{P(f[2])}@{f[3]}:{f[4]}'
    if len(f) > 5 and f[5]: spec += ':' + f[5]
    shots.append(spec)
r = subprocess.run(['node', 'tools/shots.mjs', '--w', w, '--h', h, '--out', out, '--settle', settle, *shots], capture_output=True, text=True)
print('\n'.join(l for l in r.stdout.splitlines() if 'saved' in l or 'error' in l.lower() or 'TIMEOUT' in l))
