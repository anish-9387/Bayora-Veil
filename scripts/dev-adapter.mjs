import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const cwd = resolve('services/target-adapter');
const python = resolve(cwd, process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python');
if (!existsSync(python)) throw new Error('Create services/target-adapter/venv and install its pyproject.toml dependencies first');
const child = spawn(python, ['-m', 'uvicorn', 'src.main:app', '--env-file', '../../.env', '--host', '127.0.0.1', '--port', '8000', '--reload'], { cwd, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code || 0));
