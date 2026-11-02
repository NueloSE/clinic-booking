// undefined = the visitor's own language and time zone.
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const formatDay = (iso) => dayFormat.format(new Date(iso));
export const formatTime = (iso) => timeFormat.format(new Date(iso));
export const formatSlot = (slot) => `${formatDay(slot.start)}, ${formatTime(slot.start)} – ${formatTime(slot.end)}`;
