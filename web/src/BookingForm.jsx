import { useEffect, useRef, useState } from 'react';
import { formatSlot } from './format.js';

// showModal() gives the dimmed backdrop, keeps focus in the card and closes on Esc.
export default function BookingForm({ slot, request, onBooked, onTaken, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const dialogRef = useRef(null);
  const nameRef = useRef(null);

  // Kept until the server answers, so pressing Book again after a network error
  // resends the same Idempotency-Key and can't book twice.
  const pending = useRef(null);

  useEffect(() => {
    if (!dialogRef.current.open) dialogRef.current.showModal();
    nameRef.current.focus();
  }, []);

  // A click on the backdrop lands on the <dialog> itself.
  function handleBackdropClick(event) {
    if (event.target === dialogRef.current) onClose();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const body = { slot_id: slot.id, name, email };
    const bodyText = JSON.stringify(body);
    if (pending.current?.bodyText !== bodyText) {
      pending.current = { bodyText, key: crypto.randomUUID() };
    }

    setSending(true);
    setError('');
    let res;
    try {
      res = await request('POST', '/bookings', body, { 'Idempotency-Key': pending.current.key });
    } catch {
      setError('Network problem. Press Book again to retry.');
      return;
    } finally {
      setSending(false);
    }
    pending.current = null;

    if (res.status === 201) {
      onBooked(res.data);
    } else if (res.status === 409) {
      onTaken();
    } else if (res.status === 429) {
      setError(`Too many booking attempts. Try again in ${res.retryAfter} seconds.`);
    } else if (res.status !== 401) {
      setError(res.data.error ?? 'Booking failed.');
    }
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} onClick={handleBackdropClick} aria-labelledby="booking-title">
      <form onSubmit={handleSubmit}>
        <div className="dialog-head">
          <div>
            <h2 id="booking-title">{formatSlot(slot)}</h2>
            <p className="muted">with {slot.provider}</p>
          </div>
          <button type="button" className="close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <label htmlFor="name">Name</label>
        <input
          id="name"
          ref={nameRef}
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button className="primary" disabled={sending}>
            {sending ? 'Booking…' : 'Book'}
          </button>
          <button type="button" className="link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
