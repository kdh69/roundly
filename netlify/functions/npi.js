// NPI (NPPES) doctor-registry proxy.
//
// The browser cannot call https://npiregistry.cms.hhs.gov directly — NPPES
// sends no CORS headers, so a fetch() from the app is blocked. This tiny
// serverless function fetches it server-side and returns the result with CORS
// enabled. No API key, no patient data involved (only a doctor name + city).
//
// Client calls: /.netlify/functions/npi?last_name=cowan&state=NC&city=Charlotte

const CORS = {
  'Access-Control-Allow-Origin': '*',
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
    const res = await fetch(url);
    const text = await res.text();
    return { statusCode: res.status, headers: CORS, body: text };
  } catch (err) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'NPI registry unreachable.' }) };
  }
};
