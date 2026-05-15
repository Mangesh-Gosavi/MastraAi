import 'dotenv/config';
import { Client } from 'pg';

async function init() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  
  const res = await client.query("SELECT current_database()");

  console.log('db' ,res)
  console.log('pgvector ready ✅');

}

init().catch(console.error);