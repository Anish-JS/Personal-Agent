// Telemetry must be initialized before anything else
import './telemetry.js';

import { app } from './slack.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

(async () => {
  await app.start(PORT);
  console.log(`Agent bot running on port ${PORT}`);
})();
