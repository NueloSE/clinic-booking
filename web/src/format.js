// undefined = the visitor's own language and time zone.
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const formatDay = (iso) => dayFormat.format(new Date(iso));
export const formatDate = (iso) => dateFormat.format(new Date(iso));
export const formatTime = (iso) => timeFormat.format(new Date(iso));
export const formatSlot = (slot) => `${formatDay(slot.start)}, ${formatTime(slot.start)} – ${formatTime(slot.end)}`;

// Midnight on the Monday of that week, as a number so it can be a Map key.
export function weekStart(iso) {
  const date = new Date(iso);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}
