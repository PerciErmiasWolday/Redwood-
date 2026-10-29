// Run the whole app on your computer, AI chat included, with no installs.
//
//   node tools/dev-server.js        then open http://localhost:8080
//
// The first time, it asks for your OpenAI API key in the terminal and can save it in a file named
// .env.local in this folder, so you don't have to paste it again. You can also create that file yourself:
//     OPENAI_API_KEY=sk-...
//     ACCESS_CODE=redwood218        (optional: makes visitors type a code first)
//     OPENAI_MODEL=gpt-6-luna       (optional)
// .env.local stays on your computer: .gitignore keeps it out of GitHub.

const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const ENV_FILE = path.join(ROOT, '.env.local');

function readEnvFile(file) {
  const buf = fs.readFileSync(file);
  // Notepad and PowerShell sometimes save as UTF-16; handle that and byte-order marks.
  let text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  text = text.replace(/^\ufeff/, '');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
for (const name of ['.env.local', '.env', '.env.local.txt']) {
  const file = path.join(ROOT, name);
  if (fs.existsSync(file)) readEnvFile(file);
}

function ask(rl, q) { return new Promise(resolve => rl.question(q, a => resolve(a.trim()))); }

async function askForKey() {
  if (process.env.OPENAI_API_KEY || !process.stdin.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nNo OpenAI API key found. The key stays on this computer and is only sent to OpenAI.');
  const key = await ask(rl, 'Paste your OpenAI API key (starts with sk-), or press Enter to run without the chat: ');
  if (key) {
    process.env.OPENAI_API_KEY = key;
    const save = await ask(rl, 'Save it in .env.local so you do not have to paste it next time? (y/n): ');
    if (/^y/i.test(save)) {
      fs.writeFileSync(ENV_FILE, `OPENAI_API_KEY=${key}\n`, { mode: 0o600 });
      console.log('Saved to .env.local (kept out of GitHub by .gitignore).');
    }
  }
  rl.close();
}

const guide = require('../api/guide.js');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
};

function vercelStyle(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return res; };
  return res;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/guide') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 200000) req.destroy(); });
    req.on('end', () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = {}; }
      Promise.resolve(guide(req, vercelStyle(res))).catch(err => {
        console.error(err);
        if (!res.headersSent) vercelStyle(res).status(500).json({ error: 'Server error' });
      });
    });
    return;
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || path.basename(file).startsWith('.env')) { res.statusCode = 403; return res.end('Forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  });
});

askForKey().then(() => {
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    const ai = process.env.OPENAI_API_KEY ? `ON (model ${process.env.OPENAI_MODEL || guide.DEFAULT_MODEL})` : 'OFF (no API key)';
    console.log(`\n  Redwood Relocation Guide is running at  ${url}`);
    console.log(`  AI chat: ${ai}${process.env.ACCESS_CODE ? `  |  access code required` : ''}`);
    console.log('  Keep this window open while you use it. Press Ctrl+C to stop.\n');
    if (process.stdin.isTTY && !process.env.NO_OPEN) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
});
server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is busy. Close the other copy, or run with another port: PORT=8081 node tools/dev-server.js`);
  else console.error(err);
  process.exit(1);
});
