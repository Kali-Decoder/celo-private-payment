import Fastify from "fastify";
import {assertRuntimeConfig, config} from "./config/index.js";
import {migrate, closeDb} from "./db/client.js";
import {SyncService} from "./services/SyncService.js";
import {registerRoutes} from "./api/routes.js";

async function main() {
  assertRuntimeConfig();
  await migrate();

  const sync = new SyncService();
  await sync.start();

  const app = Fastify({logger: true});

  // Browser origin must match exactly (no trailing slash).
  const origin = (process.env.CORS_ORIGIN || "*").trim().replace(/\/+$/, "") || "*";
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  await registerRoutes(app, sync);

  const shutdown = async () => {
    console.log("[main] shutting down…");
    sync.stop();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({port: config.apiPort, host: "0.0.0.0"});
  console.log(`[main] API on :${config.apiPort}`);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
