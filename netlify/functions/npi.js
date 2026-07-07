// NPI (NPPES) doctor-registry proxy.
//
// The browser cannot call https://npiregistry.cms.hhs.gov directly — NPPES
// sends no CORS headers, so a fetch() from the app is blocked. This tiny
// serverless function fetches it server-side and returns the result with CORS
// enabled. No API key, no patient data involved (only a doctor name + city).
//
// Client calls: /.netlify/functions/npi?last_name=cowan&state=NC&city=Charlotte

// Only the app itself should call this proxy from a browser. Pinning the origin
// (rather than '*') stops other sites from using it as a free, keyless NPPES
// mirror that would burn this function's invocation quota. Same-origin calls
// from the app aren't subject to CORS, so this never blocks the real app.
const CORS = {
  'Access-Control-Allow-Origin': 'https://roundly-app.netlify.app',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

// Only these NPPES search params are forwarded; everything else is ignored.
const ALLOWED = ['last_name', 'first_name', 'organization_name', 'city', 'state', 'postal_code'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const q = event.queryStringParameters || {};
  const params = new URLSearchParams({ version: '2.1' });
  let hasCriteria = false;
  for (const key of ALLOWED) {
    const val = (q[key] || '').trim();
    if (val) { params.set(key, val); hasCriteria = true; }
  }
  if (!hasCriteria) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Provide at least a name to search.' }) };
  }
  // Cap results; NPPES allows 1–200.
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 10, 1), 50);
  params.set('limit', String(limit));

  const url = `https://npiregistry.cms.hhs.gov/api/?${params.toString()}`;
  try {
    // Bound the upstream call so a stalled NPPES doesn't hold the function until
    // Netlify's 10s hard kill; the catch below returns the 502 fallback fast.
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    // NPPES reports bad queries as HTTP 200 with an { Errors: [...] } body and no
    // results, and serves plain-HTML pages during maintenance. Passing either
    // through verbatim would look like "zero matches" or make the client's
    // res.json() throw, so normalize both into a real error status here.
    let json;
    try { json = JSON.parse(text); }
    catch (_) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'NPI registry returned an unexpected response.' }) };
    }
    if (json && Array.isArray(json.Errors) && json.Errors.length) {
      const msg = json.Errors[0].description || 'NPI search was rejected.';
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: msg, results: [] }) };
    }
    return { statusCode: res.status, headers: CORS, body: text };
  } catch (err) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'NPI registry unreachable.' }) };
  }
};
