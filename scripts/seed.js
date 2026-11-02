// Loads demo slots for the next 3 days through POST /reset.
// /reset is the only way the API accepts slots, and it deletes every booking.
//
//   npm run seed                                  (local server from .env)
//   BASE_URL=https://your-app.onrender.com npm run seed

const baseUrl = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const providers = ['Dr. Obi', 'Dr. Adeyemi'];
const hours = [9, 10, 11, 14, 15, 16];

const slots = [];
for (let day = 1; day <= 3; day++) {
  for (const provider of providers) {
    for (const hour of hours) {
      // Local time on the machine running this script, 30 minutes long.
      const start = new Date();
      start.setDate(start.getDate() + day);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      slots.push({
        id: `${start.toISOString().slice(0, 10)}-${provider.split(' ')[1].toLowerCase()}-${hour}`,
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
console.log(`Loaded ${slots.length} slots into ${baseUrl}`);
