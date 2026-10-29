// The AI guide: a grounded back-and-forth chat about the employee's results.
// Runs as a Vercel serverless function at /api/guide (and in tools/dev-server.js on your computer).
//
// GET  /api/guide -> { enabled, needsCode }
// POST /api/guide -> { answer }   body: { code, messages: [{ role: "user"|"assistant", content }], evidence }
//                                 or { code, opening: true, evidence } for the guide's first message
//
// Settings (Vercel > Project > Settings > Environment Variables, or .env.local on your computer;
// never commit them):
//   OPENAI_API_KEY        required. The OpenAI key.
//   ACCESS_CODE           recommended. Visitors type this code before the guide answers.
//   OPENAI_MODEL          optional. Defaults to gpt-6-luna.
//   GUIDE_PROMPT_VERSION  optional. "v2" (default, chat) or "v1" (the first version), for comparisons.

// The underscore keeps Vercel from turning this helper file into its own endpoint.
const PROMPTS = require('./_instructions.js');

const DEFAULT_MODEL = 'gpt-6-luna';
const MAX_TURNS = 16;            // most recent messages sent to the model
const MAX_USER_CHARS = 600;
const MAX_ASSISTANT_CHARS = 2500;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 30;
const hits = new Map();          // per warm instance; a light guard, not a full rate limiter

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_REQUESTS;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

/** Clean the conversation: known roles only, trimmed text, most recent turns, ending on the user. */
function cleanMessages(body) {
  let msgs = Array.isArray(body.messages) ? body.messages : [];
  if (!msgs.length && body.question) msgs = [{ role: 'user', content: body.question }];
  msgs = msgs
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, m.role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS) }))
    .filter(m => m.content)
    .slice(-MAX_TURNS);
  return msgs;
}

function outputText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) if (c.type === 'output_text' && c.text) parts.push(c.text);
  }
  return parts.join('\n\n').trim();
}

function instructionsFor(evidenceText) {
  const version = process.env.GUIDE_PROMPT_VERSION === 'v1' ? 'v1' : 'v2';
  return { version, text: `${PROMPTS[version]}\n\nEvidence (JSON):\n${evidenceText}` };
}

module.exports = async function handler(req, res) {
  const key = process.env.OPENAI_API_KEY;
  const accessCode = process.env.ACCESS_CODE || '';
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') return res.status(200).json({ enabled: Boolean(key), needsCode: Boolean(accessCode) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!key) return res.status(503).json({ error: 'The guide is not set up on this site yet.' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'That is a lot of questions in a short time. Try again in a few minutes.' });

  const body = readBody(req);
  if (accessCode && String(body.code || '').trim() !== accessCode) {
    return res.status(401).json({ error: 'That access code is not right.', code: 'bad_code' });
  }

  // The opening request text lives on the server, so the first message is always the same request.
  const messages = body.opening ? [{ role: 'user', content: PROMPTS.OPENING_REQUEST }] : cleanMessages(body);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Type a question first.' });
  }
  const evidence = body.evidence;
  const evidenceText = JSON.stringify(evidence || null);
  if (!evidence || !Array.isArray(evidence.ranking) || evidenceText.length > 90000) {
    return res.status(400).json({ error: 'The results data was missing or too large. Reload the page and try again.' });
  }

  const { version, text: instructions } = instructionsFor(evidenceText);
  try {
    const r = await fetch(`${base}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, instructions, input: messages, max_output_tokens: 1600, store: false }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : `status ${r.status}`;
      console.error('OpenAI error:', r.status, msg);
      if (r.status === 401) return res.status(502).json({ error: 'OpenAI rejected the API key. Check OPENAI_API_KEY.' });
      if (r.status === 429) return res.status(502).json({ error: 'The OpenAI account is out of credit or over its rate limit right now.' });
      if (/model/i.test(msg)) return res.status(502).json({ error: `The model "${model}" isn't available for this key. Set OPENAI_MODEL to a model the key can use.` });
      return res.status(502).json({ error: 'The guide could not answer right now. Try again in a moment.' });
    }
    const answer = outputText(data);
    if (!answer) return res.status(502).json({ error: 'The guide ran out of room before answering. Try a shorter question.' });
    return res.status(200).json({ answer, incomplete: data.status === 'incomplete', prompt: version });
  } catch (e) {
    console.error('Guide failed:', e && e.message);
    return res.status(502).json({ error: 'The guide could not be reached. Check the internet connection and try again.' });
  }
};

module.exports.outputText = outputText;
module.exports.cleanMessages = cleanMessages;
module.exports.DEFAULT_MODEL = DEFAULT_MODEL;
