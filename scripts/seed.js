// Loads demo slots, Monday to Friday for the next 4 weeks (WEEKS=6 for more).
// It uses POST /reset, so it deletes every booking.
//
//   npm run seed
//   BASE_URL=https://your-app.vercel.app API_KEY=... npm run seed

const baseUrl = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const weeks = Number(process.env.WEEKS) || 4;
const providers = ['Dr. Obi', 'Dr. Adeyemi'];
const hours = [9, 10, 11, 14, 15, 16];

const pad = (n) => String(n).padStart(2, '0');

const slots = [];
const day = new Date();
day.setHours(0, 0, 0, 0);
let workingDays = 0;
while (workingDays < weeks * 5) {
  day.setDate(day.getDate() + 1);
  if (day.getDay() === 0 || day.getDay() === 6) continue; // weekend
  workingDays++;

  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  for (const provider of providers) {
    for (const hour of hours) {
      const start = new Date(day);
      start.setHours(hour);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      slots.push({
        id: `${date}-${provider.split(' ')[1].toLowerCase()}-${pad(hour)}`,
        provider,
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
  }
}

const res = await fetch(`${baseUrl}/reset`, {
  method: 'POST',
  headers: { 'X-API-Key': process.env.API_KEY ?? '', 'Content-Type': 'application/json' },
  body: JSON.stringify({ slots }),
});

if (!res.ok) {
  console.error(`Seeding failed: ${res.status}`, await res.text());
  process.exit(1);
}
console.log(`Loaded ${slots.length} slots (${workingDays} working days, ${slots[0].id.slice(0, 10)} to ${slots.at(-1).id.slice(0, 10)}) into ${baseUrl}`);
