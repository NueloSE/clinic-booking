// End-to-end checks of every rule in the spec, one section per level.
// They talk to a running server over HTTP, so they work locally or against
// the deployed URL. Each test starts with POST /reset, which DELETES ALL
// BOOKINGS, so never run this against a deployment you've already submitted.
//
//   npm test                                     (server from .env, e.g. npm run dev)
//   BASE_URL=https://your-app.onrender.com npm test
//   SLOW=1 npm test                              (also waits out a Retry-After, ~1 min)

import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const API_KEY = process.env.API_KEY;

async function call(method, path, { body, key = API_KEY, headers = {} } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : undefined,
    retryAfter: res.headers.get('Retry-After'),
  };
}

const hoursFromNow = (h) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

// 30 future slots s1..s30 (s1 earliest) for two providers, plus one that has started.
// They're sent out of order to check that GET /slots sorts them.
const slots = [
  ...Array.from({ length: 30 }, (_, i) => ({
    id: `s${i + 1}`,
    provider: i % 2 === 0 ? 'Dr Ade' : 'Dr Obi',
    start: hoursFromNow(i + 1),
    end: hoursFromNow(i + 1.5),
  })).reverse(),
  { id: 'past', provider: 'Dr Ade', start: hoursFromNow(-1), end: hoursFromNow(-0.5) },
];

// Every booking gets its own email unless a test says otherwise, so the
// 5-per-minute limit only kicks in where a test wants it to.
let emailCount = 0;
const uniqueEmail = () => `patient${++emailCount}-${Date.now()}@example.com`;

function book(slotId, fields = {}, headers = {}) {
  return call('POST', '/bookings', { body: { slot_id: slotId, name: 'Ada Obi', email: uniqueEmail(), ...fields }, headers });
}

function assertError(res, status) {
  assert.equal(res.status, status);
  assert.equal(typeof res.body.error, 'string');
}

beforeEach(async () => {
  const res = await call('POST', '/reset', { body: { slots } });
  assert.equal(res.status, 200);
});

describe('Level 1: list slots, book one, look up a booking', () => {
  test('GET /slots lists every slot, earliest first, all available', async () => {
    const res = await call('GET', '/slots');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.slots.map((s) => s.id), ['past', ...Array.from({ length: 30 }, (_, i) => `s${i + 1}`)]);
    assert.ok(res.body.slots.every((s) => s.available === true));
    // start and end come back exactly as they were sent.
    const s1 = slots.find((s) => s.id === 's1');
    assert.deepEqual(res.body.slots[1], { ...s1, available: true });
  });

  test('GET /slots?provider= is an exact match', async () => {
    const res = await call('GET', '/slots?provider=Dr%20Obi');
    assert.equal(res.body.slots.length, 15);
    assert.ok(res.body.slots.every((s) => s.provider === 'Dr Obi'));
    assert.equal((await call('GET', '/slots?provider=dr%20obi')).body.slots.length, 0);
  });

  test('POST /bookings returns 201 with a confirmed booking', async () => {
    const res = await book('s1', { name: 'Ada Obi', email: 'ada@example.com' });
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.id, 'string');
    assert.equal(res.body.slot_id, 's1');
    assert.equal(res.body.name, 'Ada Obi');
    assert.equal(res.body.email, 'ada@example.com');
    assert.equal(res.body.status, 'confirmed');
    assert.ok(!Number.isNaN(Date.parse(res.body.created_at)));
  });

  test('a booked slot shows available: false', async () => {
    await book('s1');
    const { body } = await call('GET', '/slots');
    assert.equal(body.slots.find((s) => s.id === 's1').available, false);
    assert.equal(body.slots.find((s) => s.id === 's2').available, true);
  });

  test('GET /bookings/{id} returns the booking, or 404', async () => {
    const created = await book('s1');
    const res = await call('GET', `/bookings/${created.body.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, created.body);
    assertError(await call('GET', '/bookings/does-not-exist'), 404);
  });

  test('/reset deletes every booking', async () => {
    const created = await book('s1');
    await call('POST', '/reset', { body: { slots } });
    assertError(await call('GET', `/bookings/${created.body.id}`), 404);
  });
});

describe('Level 2: API key and validation', () => {
  test('a missing or wrong X-API-Key gets 401 on every endpoint', async () => {
    const requests = [
      ['GET', '/slots'],
      ['POST', '/bookings'],
      ['GET', '/bookings/x'],
      ['DELETE', '/bookings/x'],
      ['GET', '/bookings?email=a@b.co'],
      ['POST', '/reset'],
    ];
    for (const [method, path] of requests) {
      assertError(await call(method, path, { key: '' }), 401);
      assertError(await call(method, path, { key: 'wrong-key' }), 401);
    }
  });

  test('missing or empty fields get 400', async () => {
    for (const field of ['slot_id', 'name', 'email']) {
      const missing = { slot_id: 's1', name: 'Ada', email: uniqueEmail() };
      delete missing[field];
      assertError(await call('POST', '/bookings', { body: missing }), 400);

      const empty = { slot_id: 's1', name: 'Ada', email: uniqueEmail(), [field]: '' };
      assertError(await call('POST', '/bookings', { body: empty }), 400);
    }
    assertError(await call('POST', '/bookings', { body: { slot_id: 's1', name: '   ', email: uniqueEmail() } }), 400);
  });

  test('an invalid email gets 400', async () => {
    for (const email of ['not-an-email', 'a@b', '@example.com', 'a b@example.com']) {
      assertError(await book('s1', { email }), 400);
    }
  });

  test('an unknown slot gets 404, a slot that has started gets 400', async () => {
    assertError(await book('nope'), 404);
    assertError(await book('past'), 400);
  });

  test('name and email are trimmed, email is stored in lower case', async () => {
    const res = await book('s1', { name: '  Ada Obi  ', email: '  Ada.Obi@Example.COM ' });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Ada Obi');
    assert.equal(res.body.email, 'ada.obi@example.com');
  });

  test('a malformed JSON body gets 400 with an error body', async () => {
    const res = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: '{"slot_id": ',
    });
    assert.equal(res.status, 400);
    assert.equal(typeof (await res.json()).error, 'string');
  });
});

describe('Level 3: no double booking, cancelling', () => {
  test('booking a slot that is already booked gets 409', async () => {
    assert.equal((await book('s1')).status, 201);
    assertError(await book('s1'), 409);
  });

  test('20 requests for the same slot at the same moment: exactly one wins', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => book('s1')));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, ...Array(19).fill(409)]);
  });

  test('DELETE cancels the booking and frees the slot', async () => {
    const created = await book('s1');
    const res = await call('DELETE', `/bookings/${created.body.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ...created.body, status: 'cancelled' });

    assert.equal((await call('GET', `/bookings/${created.body.id}`)).body.status, 'cancelled');
    const { body } = await call('GET', '/slots');
    assert.equal(body.slots.find((s) => s.id === 's1').available, true);
    assert.equal((await book('s1')).status, 201);
  });

  test('cancelling twice gets 409, an unknown booking gets 404', async () => {
    const created = await book('s1');
    await call('DELETE', `/bookings/${created.body.id}`);
    assertError(await call('DELETE', `/bookings/${created.body.id}`), 409);
    assertError(await call('DELETE', '/bookings/does-not-exist'), 404);
  });

  test('10 cancels of the same booking at once: exactly one succeeds', async () => {
    const created = await book('s1');
    const results = await Promise.all(Array.from({ length: 10 }, () => call('DELETE', `/bookings/${created.body.id}`)));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, ...Array(9).fill(409)]);
  });
});

describe('Level 4: idempotent retries and paging', () => {
  test('same Idempotency-Key and body: same response, one booking', async () => {
    const body = { slot_id: 's1', name: 'Ada', email: uniqueEmail() };
    const headers = { 'Idempotency-Key': 'retry-1' };
    const first = await call('POST', '/bookings', { body, headers });
    // Same fields in a different order is still the same body.
    const reordered = { email: body.email, name: body.name, slot_id: body.slot_id };
    const retry = await call('POST', '/bookings', { body: reordered, headers });
    assert.equal(first.status, 201);
    assert.equal(retry.status, 201);
    assert.deepEqual(retry.body, first.body);

    const list = await call('GET', `/bookings?email=${encodeURIComponent(body.email)}`);
    assert.equal(list.body.bookings.length, 1);
  });

  test('error responses are replayed too', async () => {
    const headers = { 'Idempotency-Key': 'retry-404' };
    const body = { slot_id: 'nope', name: 'Ada', email: uniqueEmail() };
    const first = await call('POST', '/bookings', { body, headers });
    const retry = await call('POST', '/bookings', { body, headers });
    assertError(first, 404);
    assert.deepEqual(retry, first);
  });

  test('same Idempotency-Key with a different body gets 422', async () => {
    const headers = { 'Idempotency-Key': 'retry-2' };
    const email = uniqueEmail();
    await call('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada', email }, headers });
    assertError(await call('POST', '/bookings', { body: { slot_id: 's2', name: 'Ada', email }, headers }), 422);
  });

  test('10 retries with the same key at the same moment: one booking', async () => {
    const body = { slot_id: 's1', name: 'Ada', email: uniqueEmail() };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call('POST', '/bookings', { body, headers: { 'Idempotency-Key': 'race' } })),
    );
    assert.ok(results.every((r) => r.status === 201));
    assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
  });

  test("GET /bookings pages through one person's bookings, oldest first", async () => {
    const ids = [];
    for (const slot of ['s3', 's1', 's2', 's5', 's4']) {
      ids.push((await book(slot, { email: 'pager@example.com' })).body.id);
    }
    await book('s6'); // someone else's

    // The email match ignores case.
    const page1 = await call('GET', '/bookings?email=PAGER@Example.com&limit=2');
    assert.equal(page1.status, 200);
    assert.deepEqual(page1.body.bookings.map((b) => b.id), ids.slice(0, 2));
    assert.equal(typeof page1.body.next_cursor, 'string');

    const page2 = await call('GET', `/bookings?email=pager@example.com&limit=2&cursor=${encodeURIComponent(page1.body.next_cursor)}`);
    assert.deepEqual(page2.body.bookings.map((b) => b.id), ids.slice(2, 4));

    const page3 = await call('GET', `/bookings?email=pager@example.com&limit=2&cursor=${encodeURIComponent(page2.body.next_cursor)}`);
    assert.deepEqual(page3.body.bookings.map((b) => b.id), ids.slice(4));
    assert.equal(page3.body.next_cursor, null);
  });

  test('cancelled bookings are listed; a full last page has next_cursor null', async () => {
    const email = 'cancel-list@example.com';
    const a = await book('s1', { email });
    await book('s2', { email });
    await call('DELETE', `/bookings/${a.body.id}`);
    const res = await call('GET', `/bookings?email=${email}&limit=2`);
    assert.deepEqual(res.body.bookings.map((b) => b.status), ['cancelled', 'confirmed']);
    assert.equal(res.body.next_cursor, null);
  });

  test('limit must be a whole number from 1 to 50', async () => {
    for (const limit of ['0', '51', '-1', 'abc', '1.5', '']) {
      assertError(await call('GET', `/bookings?email=a@example.com&limit=${limit}`), 400);
    }
    for (const limit of ['1', '50']) {
      assert.equal((await call('GET', `/bookings?email=a@example.com&limit=${limit}`)).status, 200);
    }
  });

  test('a bad cursor or a missing email gets 400', async () => {
    assertError(await call('GET', '/bookings?email=a@example.com&cursor=not-a-cursor!'), 400);
    assertError(await call('GET', '/bookings'), 400);
  });
});

describe('Level 5: at most 5 booking attempts per email per minute', () => {
  test('the 6th attempt gets 429 with Retry-After; failed attempts count', async () => {
    const email = 'spammer@example.com';
    const statuses = [];
    statuses.push((await book('s1', { email })).status); // 201
    statuses.push((await book('s1', { email })).status); // 409
    statuses.push((await book('nope', { email })).status); // 404
    statuses.push((await book('s2', { email, name: '' })).status); // 400
    statuses.push((await book('s2', { email: '  SPAMMER@example.com ' })).status); // 201, same email
    assert.deepEqual(statuses, [201, 409, 404, 400, 201]);

    const sixth = await book('s3', { email });
    assertError(sixth, 429);
    assert.match(sixth.retryAfter, /^\d+$/);
    assert.ok(Number(sixth.retryAfter) >= 1 && Number(sixth.retryAfter) <= 60);
  });

  test('other emails are not affected', async () => {
    for (let i = 0; i < 6; i++) await book('nope', { email: 'busy@example.com' });
    assert.equal((await book('s1')).status, 201);
  });

  test('replayed Idempotency-Key requests are not new attempts', async () => {
    const email = 'retrier@example.com';
    const body = { slot_id: 's1', name: 'Ada', email };
    for (let i = 0; i < 6; i++) {
      assert.equal((await call('POST', '/bookings', { body, headers: { 'Idempotency-Key': 'same' } })).status, 201);
    }
    // Only the first counted, so 4 more attempts are allowed.
    for (const slot of ['s2', 's3', 's4', 's5']) assert.equal((await book(slot, { email })).status, 201);
    assertError(await book('s6', { email }), 429);
  });

  test('10 attempts for one email at the same moment: exactly 5 get through', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => book(`s${i + 1}`, { email: 'burst@example.com' })),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 5);
    assert.equal(results.filter((r) => r.status === 429).length, 5);
  });

  test('waiting Retry-After seconds is enough', { skip: !process.env.SLOW && 'set SLOW=1 to run (~1 minute)' }, async () => {
    const email = 'patient@example.com';
    for (let i = 1; i <= 5; i++) await book(`s${i}`, { email });
    const limited = await book('s6', { email });
    assert.equal(limited.status, 429);
    await new Promise((resolve) => setTimeout(resolve, Number(limited.retryAfter) * 1000));
    assert.equal((await book('s6', { email })).status, 201);
  });
});

describe('Web page', () => {
  test('GET / serves the page without a key', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<div id="root">/);
  });
});
