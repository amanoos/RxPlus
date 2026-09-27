import { defineConfig } from 'drizzle-kit';

// drizzle-kit doesn't read .env itself; Node 24 can.
try {
  process.loadEnvFile();
} catch {
  // No .env: rely on the real environment.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? '' },
});
