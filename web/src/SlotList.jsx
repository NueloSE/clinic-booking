import { formatDate, formatDay, formatTime, weekStart } from './format.js';

export default function SlotList({ slots, selectedId, onSelect, week, onWeekChange }) {
  if (slots.length === 0) {
    return <p className="muted">No upcoming slots right now.</p>;
  }

  const weeks = [...Map.groupBy(slots, (slot) => weekStart(slot.start))];
  // Start on the first week until the user picks one (or it's no longer there).
  const index = Math.max(0, weeks.findIndex(([start]) => start === week));
  const weekSlots = weeks[index][1];
  const days = Map.groupBy(weekSlots, (slot) => formatDay(slot.start));

  return (
    <>
      <div className="week-nav">
        <button type="button" className="link" disabled={index === 0} onClick={() => onWeekChange(weeks[index - 1][0])}>
          ‹ Previous
        </button>
        <div>
          <strong>
            {formatDate(weekSlots[0].start)} – {formatDate(weekSlots.at(-1).start)}
          </strong>
          <span className="muted">
            Week {index + 1} of {weeks.length}
          </span>
        </div>
        <button
          type="button"
          className="link"
          disabled={index === weeks.length - 1}
          onClick={() => onWeekChange(weeks[index + 1][0])}
        >
          Next ›
        </button>
      </div>

      {[...days].map(([day, daySlots]) => (
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
      ))}
    </>
  );
}
