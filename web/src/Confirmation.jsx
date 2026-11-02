import { useState } from 'react';
import { formatSlot } from './format.js';

export default function Confirmation({ booking, slot, onCancel, onDone }) {
  const [error, setError] = useState('');
  const cancelled = booking.status === 'cancelled';

  async function handleCancel() {
    if (!window.confirm('Cancel this booking?')) return;
    setError('');
    try {
      const { status, data } = await onCancel(booking.id);
      if (status !== 200 && status !== 409 && status !== 401) {
        setError(data.error ?? 'Could not cancel the booking.');
      }
    } catch {
      setError('Network problem. Please try again.');
    }
  }

  return (
    <section className={cancelled ? 'card cancelled' : 'card confirmed'}>
      <h2>{cancelled ? 'Booking cancelled' : "✓ You're booked"}</h2>
      <dl>
        <dt>When</dt>
        <dd>{formatSlot(slot)}</dd>
        <dt>With</dt>
        <dd>{slot.provider}</dd>
        <dt>Name</dt>
        <dd>{booking.name}</dd>
        <dt>Email</dt>
        <dd>{booking.email}</dd>
        <dt>Status</dt>
        <dd>{booking.status}</dd>
        <dt>Booking ID</dt>
        <dd>{booking.id}</dd>
      </dl>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="primary" onClick={onDone}>
          Book another
        </button>
        {!cancelled && (
          <button type="button" className="link danger" onClick={handleCancel}>
            Cancel booking
          </button>
        )}
      </div>
    </section>
  );
}
