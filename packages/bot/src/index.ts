// OTel SDK must be initialized before any other import
import './telemetry-init.js';

import { app } from './slack.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

(async () => {
  await app.start(PORT);
  console.log(`Agent bot running on port ${PORT}`);
})();
