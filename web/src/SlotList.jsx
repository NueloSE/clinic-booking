import { formatDay, formatTime } from './format.js';

export default function SlotList({ slots, selectedId, onSelect }) {
  if (slots.length === 0) {
    return <p className="muted">No upcoming slots right now.</p>;
  }

  // The API sends slots earliest first, so each day's group stays in order.
  const days = Map.groupBy(slots, (slot) => formatDay(slot.start));

  return [...days].map(([day, daySlots]) => (
    <section key={day}>
      <h2>{day}</h2>
      <div className="slots">
        {daySlots.map((slot) => (
          <button
            key={slot.id}
            type="button"
            className="slot"
            disabled={!slot.available}
            aria-pressed={slot.id === selectedId}
            onClick={() => onSelect(slot)}
          >
            <strong>{formatTime(slot.start)}</strong>
            <span>{slot.available ? slot.provider : `${slot.provider} · booked`}</span>
          </button>
        ))}
      </div>
    </section>
  ));
}
