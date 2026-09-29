/* Starts the real server binary (Go) for the tests: fresh data folder, free port, test mode. */
'use strict';
const { spawn, execFileSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'test', '.bin', 'gmc-registry-server');

function build() {
  const src = path.join(ROOT, 'server');
  const newest = Math.max(...fs.readdirSync(src).map((f) => fs.statSync(path.join(src, f)).mtimeMs));
  if (fs.existsSync(BIN) && fs.statSync(BIN).mtimeMs > newest) return BIN;
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  execFileSync('go', ['build', '-o', BIN, '.'], { cwd: src, stdio: 'inherit' });
  return BIN;
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function startServer(opts) {
  const o = opts || {};
  const bin = process.env.GMC_SERVER_BIN || build();
  const dataDir = o.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'gmc-srv-'));
  const port = o.port || (await freePort());
  const args = ['--port', String(port), '--data', dataDir, '--test-mode'].concat(o.args || []);
  const proc = spawn(bin, args, { stdio: o.verbose ? 'inherit' : 'ignore' });
  const url = 'http://127.0.0.1:' + port;
  const until = Date.now() + 15000;
  for (;;) {
    try {
      const r = await fetch(url + '/api/health');
      if (r.ok) break;
    } catch (e) {
      /* not yet */
    }
    if (Date.now() > until) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    dataDir,
    proc,
    /** Registry as stored on disk. */
    registry() {
      const f = path.join(dataDir, 'registry.json');
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).data : null;
    },
    exams() {
      const d = path.join(dataDir, 'exams');
      return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))) : [];
    },
    attempts(examId) {
      const d = path.join(dataDir, 'attempts', String(examId));
      return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))) : [];
    },
    stop(keep) {
      return new Promise((resolve) => {
        proc.once('exit', () => {
          if (!keep && !o.dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
          resolve();
        });
        proc.kill('SIGTERM');
      });
    },
  };
}

module.exports = { startServer, build };
