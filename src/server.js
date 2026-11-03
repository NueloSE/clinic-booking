import app from './app.js';
import { migrate } from './db.js';

const port = Number(process.env.PORT) || 3000;

await migrate();

app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
