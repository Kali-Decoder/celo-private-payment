import {migrate, closeDb} from "./client.js";

migrate()
  .then(async () => {
    await closeDb();
    console.log("migrate ok");
  })
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
