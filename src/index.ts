import 'dotenv/config';
import { loadSecrets } from './loadSecrets';

if (!process.env.PORT) {
  throw new Error('PORT environment variable is not set');
}

const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT);

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const secretsSource = process.env.SECRETS_SOURCE;

if (secretsSource === 'key-vault') {
  await loadSecrets();
} else if (secretsSource !== 'local') {
  throw new Error('SECRETS_SOURCE must be local or key-vault');
}
const { createApp } = await import('./app');
const app = createApp();

// Register new controllers / middleware here!

// app.use('/', ...)

// Keep everything below this comment at the bottom of the file
const server = app.listen(PORT, HOST, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (app.reservationExpirationJob) {
      app.reservationExpirationJob.stop();
    }
    server.close(() => process.exit(0));
  });
}
