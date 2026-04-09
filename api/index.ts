import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_DATABASE_ID = process.env.CLOUDFLARE_DATABASE_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

async function queryD1(sql: string, params: any[] = []) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    throw new Error("Lỗi: Chưa cấu hình Environment Variables (Account ID, Database ID, API Token) trên Vercel.");
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const msg = data.errors?.[0]?.message || data.error || "D1 Query Error";
    if (msg.includes("no such table")) {
      throw new Error("Lỗi: Bảng dữ liệu chưa tồn tại trong Cloudflare D1. Vui lòng chạy lệnh SQL tạo bảng.");
    }
    throw new Error(msg);
  }
  return data.result?.[0] || data;
}

const app = express();
app.use(express.json({ limit: '50mb' }));

// API: Get Settings
app.get("/api/settings", async (req, res) => {
  try {
    const result = await queryD1("SELECT value FROM settings WHERE key = 'main'");
    if (result && result.results && result.results.length > 0) {
      res.json(JSON.parse(result.results[0].value));
    } else {
      res.json({});
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Save Settings
app.post("/api/settings", async (req, res) => {
  try {
    const settings = JSON.stringify(req.body);
    await queryD1(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('main', ?)",
      [settings]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Search Subscriber
app.get("/api/subscribers/:last9", async (req, res) => {
  try {
    const result = await queryD1(
      "SELECT * FROM subscribers WHERE last9Digits = ?",
      [req.params.last9]
    );
    if (result && result.results && result.results.length > 0) {
      res.json(result.results[0]);
    } else {
      res.status(404).json({ error: "Not found" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Batch Import Subscribers
app.post("/api/subscribers/batch", async (req, res) => {
  const { subscribers } = req.body;
  if (!Array.isArray(subscribers) || subscribers.length === 0) {
    return res.status(400).json({ error: "Invalid data" });
  }

  try {
    let sql = "INSERT OR REPLACE INTO subscribers (last9Digits, fullPhoneNumber, status) VALUES ";
    const params: any[] = [];
    const placeholders = subscribers.map(s => {
      params.push(s.last9Digits, s.fullPhoneNumber, s.status);
      return "(?, ?, ?)";
    });
    sql += placeholders.join(", ");
    
    await queryD1(sql, params);
    res.json({ success: true, count: subscribers.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default app;

if (process.env.NODE_ENV !== "production" && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = 3000;
  async function startDev() {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Dev server running on http://localhost:${PORT}`);
    });
  }
  startDev();
}
