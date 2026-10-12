"""Temporary probe: which Edge version header does the Microsoft voice service accept from this runner."""
import asyncio, importlib, os, re, subprocess, sys
import edge_tts.constants as c
path = c.__file__
original = open(path).read()
results = []
for version in [None] + [f'{m}.0.{3300 + (m - 140) * 60}.{50 + m}' for m in range(144, 157)]:
    text = original if version is None else re.sub(r'CHROMIUM_FULL_VERSION = "[^"]+"', f'CHROMIUM_FULL_VERSION = "{version}"', original)
    open(path, 'w').write(text)
    code = ("import asyncio,edge_tts,os\n"
            "async def m():\n await edge_tts.Communicate('hello world','en-US-AndrewNeural').save('/tmp/p.mp3')\n"
            "asyncio.run(m());print(os.path.getsize('/tmp/p.mp3'))")
    run = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=60)
    status = run.stdout.strip() if run.returncode == 0 else (re.findall(r'\d{3}, message=[^,]+', run.stderr) or [run.stderr.strip()[-150:]])[0]
    print(version or 'default 143', '=>', status, flush=True)
open(path, 'w').write(original)
