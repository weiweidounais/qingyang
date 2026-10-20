import { createConnection } from "mysql2/promise";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { projectRoot, users } from "./runtime.js";

// 仅在本项目新建的独立开发库初始化；已有表时不重复跑V001。
const file = `${projectRoot}/.local/m03-db.json`;
let config: any;
try {
  config = JSON.parse(await readFile(file, "utf8"));
} catch {
  config = {
    socketPath: "/tmp/qingyang-m03-501.sock",
    database: "qingyang_dev_m03",
    password: randomBytes(32).toString("hex"),
    cursorSecret: randomBytes(32).toString("hex"),
    sessionSecret: randomBytes(32).toString("hex"),
  };
}
let conn;
try {
  conn = await createConnection({
    socketPath: config.socketPath,
    user: "root",
    password: config.password,
    multipleStatements: true,
    timezone: "Z",
  });
} catch (e) {
  if ((e as any).code !== "ER_ACCESS_DENIED_ERROR") throw e;
  conn = await createConnection({
    socketPath: config.socketPath,
    user: "root",
    multipleStatements: true,
    timezone: "Z",
  });
  await conn.query("ALTER USER CURRENT_USER() IDENTIFIED BY ?", [
    config.password,
  ]);
}
await mkdir(`${projectRoot}/.local`, { recursive: true });
await writeFile(file, JSON.stringify(config), { mode: 0o600 });
await conn.query(
  `CREATE DATABASE IF NOT EXISTS qingyang_dev_m03 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
);
await conn.changeUser({
  user: "root",
  password: config.password,
  database: config.database,
});
const [tables] = await conn.query("SHOW TABLES");
if (!(tables as any[]).length) {
  const sql = await readFile(
    `${projectRoot}/server/db/migrations/V001__baseline.sql`,
    "utf8",
  );
  if (
    createHash("sha256").update(sql).digest("hex") !==
    "64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56"
  )
    throw Error("V001 checksum mismatch");
  await conn.query(sql);
  await writeFile(
    `${projectRoot}/.local/m03-baseline-applied.json`,
    JSON.stringify({
      schemaVersion: "V001",
      baselineSha256:
        "64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56",
      appliedAt: new Date().toISOString(),
    }),
  );
}
for (const [key, id] of Object.entries(users))
  await conn.query(
    "INSERT INTO users (id,phone_ciphertext,phone_lookup_hash,nickname) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE nickname=VALUES(nickname)",
    [
      id,
      "LOCAL_FIXTURE_NOT_A_PHONE",
      createHash("sha256").update(`local-m03-fixture-${key}`).digest("hex"),
      `本地测试账号${key.toUpperCase()}`,
    ],
  );
try {
  const foods = JSON.parse(
    await readFile(`${projectRoot}/server/db/seeds/M03/foods.json`, "utf8"),
  );
  for (const f of foods)
    await conn.query(
      "INSERT INTO foods (id,name,calories_per_100g,carbs_per_100g,protein_per_100g,fat_per_100g,source) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)",
      [f.id, f.name, f.caloriesKcal, f.carbsG, f.proteinG, f.fatG, f.source],
    );
} catch (e) {
  if ((e as any).code !== "ENOENT") throw e;
}
const [version] = await conn.query("SELECT VERSION() version");
console.log({
  database: config.database,
  version,
  message: "独立开发库就绪，未导入任何饮食历史或积分",
});
await conn.end();
