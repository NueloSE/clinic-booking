import { useEffect, useState } from 'react';
import { api } from './api.js';
import KeyForm from './KeyForm.jsx';
import SlotList from './SlotList.jsx';
import BookingForm from './BookingForm.jsx';
import Confirmation from './Confirmation.jsx';
import MyBookings from './MyBookings.jsx';

// Kept for this browser tab only.
function readKey() {
  try {
    return sessionStorage.getItem('apiKey') ?? '';
  } catch {
    return '';
  }
}

function storeKey(key) {
  try {
    if (key) sessionStorage.setItem('apiKey', key);
    else sessionStorage.removeItem('apiKey');
  } catch {
    // Storage blocked; the key just won't survive a refresh.
  }
}

export default function App() {
  const [apiKey, setApiKey] = useState(readKey);
  const [keyError, setKeyError] = useState('');
  const [slots, setSlots] = useState(null);
  const [selected, setSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('book');
  const [lastEmail, setLastEmail] = useState('');
  const [week, setWeek] = useState(null);

  function changeKey(key, error = '') {
    storeKey(key);
    setApiKey(key);
    setKeyError(error);
    setSlots(null);
  }

  // A 401 sends the user back to the key form.
  async function request(method, path, body, headers) {
    const res = await api(apiKey, method, path, body, headers);
    if (res.status === 401) changeKey('', 'That API key was not accepted.');
    return res;
  }

  async function loadSlots() {
    setSelected(null);
    setNotice('');
    try {
      const { status, data } = await request('GET', '/slots');
      if (status === 200) {
        setSlots(data.slots);
      } else if (status !== 401) {
        setNotice(data.error ?? 'Could not load slots.');
      }
    } catch {
      setNotice('Could not load slots. Check your connection and refresh.');
    }
  }

  useEffect(() => {
    if (apiKey) loadSlots();
  }, [apiKey]);

  async function handleTaken() {
    await loadSlots();
    setNotice('Sorry, someone just booked that slot. Please pick another.');
  }

  function handleBooked(booking) {
    setConfirmed({ booking, slot: selected });
    setLastEmail(booking.email);
  }

  function bookAnother() {
    setConfirmed(null);
    setSlots(null); // The old list would still show the booked slot as free.
    loadSlots();
  }

  async function cancelBooking(id) {
    const res = await request('DELETE', `/bookings/${encodeURIComponent(id)}`);
    // 409: it was already cancelled.
    if (res.status === 200 || res.status === 409) {
      setConfirmed((c) => (c?.booking.id === id ? { ...c, booking: { ...c.booking, status: 'cancelled' } } : c));
    }
    if (res.status === 200) loadSlots();
    return res;
  }

  if (!apiKey) {
    return (
      <main>
        <h1>Book an appointment</h1>
        <p className="lead">Enter the API key to get started.</p>
        <KeyForm error={keyError} onSubmit={changeKey} />
      </main>
    );
  }

  // Slots that have started can't be booked.
  const now = new Date();
  const upcoming = slots?.filter((slot) => new Date(slot.start) > now);
  const slotsById = new Map((slots ?? []).map((slot) => [slot.id, slot]));

  let content;
  if (tab === 'mine') {
    content = <MyBookings request={request} slotsById={slotsById} initialEmail={lastEmail} onCancel={cancelBooking} />;
  } else if (confirmed) {
    content = (
      <Confirmation booking={confirmed.booking} slot={confirmed.slot} onCancel={cancelBooking} onDone={bookAnother} />
    );
  } else {
    content = (
      <>
        <h2>Available slots</h2>
        {notice && <p className="notice" role="status">{notice}</p>}
        {upcoming === undefined ? (
          !notice && <p className="muted">Loading slots…</p>
        ) : (
          <SlotList
            slots={upcoming}
            selectedId={selected?.id}
            onSelect={setSelected}
            week={week}
            onWeekChange={setWeek}
          />
        )}
        {selected && (
          <BookingForm
            slot={selected}
            request={request}
            onBooked={handleBooked}
            onTaken={handleTaken}
            onClose={() => setSelected(null)}
          />
        )}
      </>
    );
  }

  return (
    <main>
      <h1>Book an appointment</h1>
      <p className="lead">Pick a free slot, enter your details and you're booked.</p>
      <div className="bar">
        <nav className="tabs">
          <button type="button" className="tab" aria-pressed={tab === 'book'} onClick={() => setTab('book')}>
            Book
          </button>
          <button type="button" className="tab" aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>
            My bookings
          </button>
        </nav>
        <button type="button" className="link" onClick={() => changeKey('')}>
          Change API key
        </button>
      </div>
      {content}
    </main>
  );
}
