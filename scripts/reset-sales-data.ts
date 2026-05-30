import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  couponsTable,
  orderItemsTable,
  ordersTable,
  promotionsTable,
} from "../db/schema.ts";

const schemaName = process.env.PG_SCHEMA || "bf_v10";

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
  throw new Error(`Unsafe PG_SCHEMA: ${schemaName}`);
}

async function resetSalesData() {
  console.log("Resetting orders, order items, coupons, and promotions...");

  await db.delete(orderItemsTable);
  await db.delete(ordersTable);
  await db.delete(couponsTable);
  await db.delete(promotionsTable);

  await db.execute(
    sql.raw(
      `ALTER TABLE "${schemaName}"."orders" ALTER COLUMN "id" RESTART WITH 1`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE "${schemaName}"."order_items" ALTER COLUMN "id" RESTART WITH 1`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE "${schemaName}"."promotions" ALTER COLUMN "id" RESTART WITH 1`,
    ),
  );

  console.log("Done. Users and menu tables were not changed.");
}

resetSalesData()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
