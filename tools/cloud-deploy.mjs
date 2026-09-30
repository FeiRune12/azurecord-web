import fs from "node:fs";
import { spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(args, options = {}) {
  const result = spawnSync(npx, args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["inherit", "pipe", "pipe"],
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (!options.inherit) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    process.exit(result.status || 1);
  }
  return result.stdout || "";
}

console.log("[Azurecord] Localizando o D1 azurecord-prod...");
const output = run(["wrangler", "d1", "list", "--json"]);
let databases;
try {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("JSON não encontrado");
  databases = JSON.parse(output.slice(start, end + 1));
} catch {
  console.error("[Azurecord] Não consegui interpretar 'wrangler d1 list --json'.");
  console.error(output);
  process.exit(1);
}

const db = databases.find(item =>
  String(item?.name || item?.database_name || "").toLowerCase() === "azurecord-prod"
);
const databaseId = db?.uuid || db?.id || db?.database_id;
if (!databaseId) {
  console.error("[Azurecord] O banco D1 'azurecord-prod' não foi encontrado nesta conta Cloudflare.");
  process.exit(1);
}

const configPath = new URL("../wrangler.toml", import.meta.url);
let config = fs.readFileSync(configPath, "utf8");
config = config.replace(
  /database_id\s*=\s*"[^"]*"/,
  `database_id = "${databaseId}"`
);
fs.writeFileSync(configPath, config, "utf8");

console.log(`[Azurecord] D1 encontrado: ${databaseId}`);
console.log("[Azurecord] Publicando Worker 0.8.2 + WebSocket Realtime...");
run(["wrangler", "deploy"], { inherit: true });
