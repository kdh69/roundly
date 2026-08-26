// VM harness for the HIPAA-hardening code paths in index.html.
// Run: node tests/hipaa_tests.js   (no deps; Node 18+)
// Loads the whole inline script with stubbed browser globals, then exercises
// PIN hashing/migration/backoff, outbox purge, idle re-lock, and data deletion
// INSIDE the VM context (top-level `let`s are only reachable there).
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
let m, js = '';
while ((m = re.exec(html))) js += m[1] + '\n;\n';

// ── stubs ──────────────────────────────────────────────────────────────────
function makeEl() {
  const set = new Set();
  return {
    classList: { add: c => set.add(c), remove: c => set.delete(c), toggle: (c, f) => f ? set.add(c) : set.delete(c), contains: c => set.has(c), _set: set },
    style: {}, textContent: '', innerHTML: '', value: '',
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, appendChild() {}, remove() {}, click() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
  };
}
const els = {};
const store = {};
const intervals = [];
const ctx = {};

Object.assign(ctx, {
  console, TextEncoder, URL, URLSearchParams, JSON, Math, Date, Promise, Array, Object, Number, String, Boolean, RegExp, Map, Set, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  crypto: require('crypto').webcrypto,
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5)), // compress delays
  clearTimeout, setInterval: fn => { intervals.push(fn); return 0; }, clearInterval() {},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  navigator: { onLine: true, userAgent: 'test', language: 'en-US' },
  location: { reload() {}, href: '', origin: 'https://roundly-app.netlify.app', search: '' },
  history: { replaceState() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  confirm: () => true, prompt: () => 'DELETE', alert() {},
  fetch: async () => { throw new Error('offline'); },
  document: {
    getElementById: id => (els[id] || (els[id] = makeEl())),
    addEventListener() {}, removeEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
    createElement: () => makeEl(),
    documentElement: makeEl(), body: makeEl(), head: { appendChild() {} },
    visibilityState: 'visible',
  },
  supabase: { createClient: () => ({ auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: null } }), signOut: async () => {} }, from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }) }) },
  IntersectionObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  Image: class {},
  screen: { orientation: {} },
});
ctx.addEventListener = () => {};
ctx.removeEventListener = () => {};
ctx.requestAnimationFrame = fn => setTimeout(fn, 1);
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(js, ctx, { filename: 'roundly-inline.js' });

// ── tests ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };
const run = src => vm.runInContext(src, ctx);

(async () => {
  // fixture: signed-in user
  run(`currentUser={id:'user-abc',name:'T',email:'t@x.com'};`);

  console.log('PIN hashing');
  const h1 = await run(`hashPin('1234')`);
  const h2 = await run(`hashPin('1234')`);
  ok(/^s[0-9a-f]{64}$/.test(h1), 'hashPin → s + 64 hex chars');
  ok(h1 === h2, 'deterministic');
  run(`currentUser.id='other-user';`);
  const h3 = await run(`hashPin('1234')`);
  ok(h3 !== h1, 'salted per account id');
  run(`currentUser.id='user-abc';`);

  console.log('Legacy migration on unlock');
  run(`pinHash=simpleHash('4321'); appUnlocked=false; pinSetupStage=null; pinEntryBuffer='4321';`);
  ok(await run(`pinMatches('4321')`) === true, 'legacy h… hash still verifies');
  await run(`handlePinComplete()`);
  ok(run(`appUnlocked`) === true, 'unlocked with legacy hash');
  ok(String(run(`pinHash`)).startsWith('s'), 'hash upgraded to SHA-256 format');
  ok(String(store['roundlyPinHash_user-abc']).startsWith('s'), 'upgraded hash persisted');

  console.log('Wrong-PIN backoff');
  run(`pinHash=null;`); run(`setPinFails({n:0,until:0})`);
  const real = await run(`hashPin('9999')`);
  run(`pinHash=${JSON.stringify(real)}; appUnlocked=false;`);
  for (let i = 0; i < 5; i++) { run(`pinSetupStage=null; pinEntryBuffer='0000';`); await run(`handlePinComplete()`); }
  let fails = run(`getPinFails()`);
  ok(fails.n === 5 && fails.until > Date.now(), '5 misses → timed lockout');
  run(`pinSetupStage=null; pinEntryBuffer='9999';`); await run(`handlePinComplete()`);
  ok(run(`appUnlocked`) === false, 'correct PIN still blocked during lockout');
  run(`setPinFails({n:5,until:Date.now()-1})`);
  run(`pinSetupStage=null; pinEntryBuffer='9999';`); await run(`handlePinComplete()`);
  ok(run(`appUnlocked`) === true, 'correct PIN unlocks after lockout expires');
  ok(run(`getPinFails()`).n === 0, 'fail counter reset on success');

  console.log('Outbox purge');
  run(`outbox=[{kind:'visit-update',id:1,payload:{name:'PATIENT X',addr:'1 Main St'}}]; saveOutbox();`);
  ok(!!store['roundlyOutbox_user-abc'], 'outbox persisted with PHI');
  run(`purgeOutboxLocal()`);
  ok(!('roundlyOutbox_user-abc' in store), 'purge removes localStorage key');
  ok(run(`outbox.length`) === 0, 'purge empties in-memory queue');

  console.log('Idle re-lock');
  run(`appUnlocked=true; lastActivityAt=Date.now()-16*60*1000;`);
  run(`maybeIdleLock()`);
  ok(run(`appUnlocked`) === false, 'locks after 15 min idle when PIN set');
  ok(els['lock-screen'].classList.contains('show'), 'lock screen shown');
  run(`appUnlocked=true; lastActivityAt=Date.now()-16*60*1000;`);
  els['drive-mode'].classList.add('open');
  run(`maybeIdleLock()`);
  ok(run(`appUnlocked`) === true, 'never locks during Drive Mode');
  els['drive-mode'].classList.remove('open');
  run(`pinHash=null; appUnlocked=true; lastActivityAt=Date.now()-16*60*1000;`);
  run(`maybeIdleLock()`);
  ok(run(`appUnlocked`) === true, 'no PIN → no idle lock (experience unchanged)');

  console.log('Delete all data');
  run(`pinHash='sxx'; appUnlocked=true;`);
  store['roundlyPinHash_user-abc'] = 'sxx';
  store['roundlyOutbox_user-abc'] = '[{"kind":"x"}]';
  await run(`deleteAllMyData()`);
  ok(!('roundlyOutbox_user-abc' in store), 'outbox gone after account wipe');
  ok(!('roundlyPinHash_user-abc' in store), 'pin hash gone after account wipe');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
