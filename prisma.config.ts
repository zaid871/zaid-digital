import { defineConfig, env } from "prisma/config";

// Prisma 7: connection URLs for migrate/introspect live here,
// NOT in the schema.prisma datasource block.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
