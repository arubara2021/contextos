require("dotenv").config();
const { Client } = require("pg");

const url = process.env.COCKROACH_CONNECTION_STRING;

if (!url) {
  console.error("COCKROACH_CONNECTION_STRING is missing in backend/.env");
  process.exit(1);
}

const adminUrl = url.replace(/\/contextos(\?|$)/, "/defaultdb$1");

async function main() {
  const client = new Client({ connectionString: adminUrl });

  await client.connect();

  await client.query("DROP DATABASE IF EXISTS contextos CASCADE");
  await client.query("CREATE DATABASE contextos");

  await client.end();

  console.log("Database reset complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});