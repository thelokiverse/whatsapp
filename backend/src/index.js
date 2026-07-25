require('dotenv').config();
const { createApp } = require('./app');

// Last-resort safety net: log and keep running rather than let one bad
// request/rejection take down the WhatsApp bot for everyone else on this
// same process. app.js's error middleware should catch almost everything
// before it gets here.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`WhatsApp Flow backend listening on port ${PORT}`);
});
