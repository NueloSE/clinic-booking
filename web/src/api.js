// Throws only if there's no response at all, e.g. the network is down.
export async function api(apiKey, method, path, body, headers = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, retryAfter: res.headers.get('Retry-After') };
}
