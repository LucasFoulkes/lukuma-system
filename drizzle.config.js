import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database.js',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './system.db',
  },
});
