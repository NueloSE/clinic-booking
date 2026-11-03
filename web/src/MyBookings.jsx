import { useState } from 'react';
import { formatSlot } from './format.js';

const PAGE_SIZE = 10;

export default function MyBookings({ request, slotsById, initialEmail, onCancel }) {
  const [email, setEmail] = useState(initialEmail);
  const [bookings, setBookings] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // With a cursor, adds the next page to the list.
  async function load(cursor) {
    const params = new URLSearchParams({ email: email.trim(), limit: PAGE_SIZE });
    if (cursor) params.set('cursor', cursor);

    setLoading(true);
    setError('');
    try {
      const { status, data } = await request('GET', `/bookings?${params}`);
      if (status === 200) {
        setBookings((shown) => (cursor ? [...shown, ...data.bookings] : data.bookings));
        setNextCursor(data.next_cursor);
      } else if (status !== 401) {
        setError(data.error ?? 'Could not load bookings.');
      }
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    load(null);
  }

  function replace(updated) {
    setBookings((shown) => shown.map((b) => (b.id === updated.id ? updated : b)));
  }

  async function handleCancel(booking) {
    if (!window.confirm('Cancel this booking?')) return;
    setError('');
    try {
      const { status, data } = await onCancel(booking.id);
      if (status === 200) {
        replace(data);
      } else if (status === 409) {
        replace({ ...booking, status: 'cancelled' });
        setError('That booking was already cancelled.');
      } else if (status !== 401) {
        setError(data.error ?? 'Could not cancel the booking.');
      }
    } catch {
      setError('Network problem. Please try again.');
    }
  }

  return (
    <>
      <form className="card search" onSubmit={handleSubmit}>
        <label htmlFor="lookup-email">Email</label>
        <div className="row">
          <input
            id="lookup-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="primary" disabled={loading}>
            Show
          </button>
        </div>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {bookings?.length === 0 && <p className="muted">No bookings for this email.</p>}

      {bookings?.length > 0 && (
        <ul className="bookings">
          {bookings.map((booking) => {
            const slot = slotsById.get(booking.slot_id);
            return (
              <li key={booking.id} className="card">
                <div>
                  <strong>{slot ? formatSlot(slot) : `Slot ${booking.slot_id}`}</strong>
                  <span className="muted">
                    {slot && `${slot.provider} · `}
                    {booking.name}
                  </span>
                </div>
                <span className={`status ${booking.status}`}>{booking.status}</span>
                {booking.status === 'confirmed' && (
                  <button type="button" className="link danger" onClick={() => handleCancel(booking)}>
                    Cancel
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && (
        <button type="button" className="primary" disabled={loading} onClick={() => load(nextCursor)}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}
