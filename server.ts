import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function queryD1(sql: string, params: any[] = []) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    throw new Error("Lỗi: Chưa cấu hình Environment Variables (Account ID, Database ID, API Token).");
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

// API: Get Stats
app.get("/api/subscribers/stats", async (req, res) => {
  try {
    const result = await queryD1("SELECT COUNT(*) as total FROM subscribers");
    res.json(result.results?.[0] || { total: 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Search Subscriber
app.get("/api/subscribers/:last9", async (req, res) => {
  try {
    const result = await queryD1(
      "SELECT * FROM subscribers WHERE last9Digits = ? LIMIT 1",
      [req.params.last9]
    );
    if (result && result.results && result.results.length > 0) {
      res.json(result.results[0]);
    } else {
      res.status(404).json({ error: "Không tìm thấy thông tin cho số thuê bao này." });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Batch Import Subscribers
app.post("/api/subscribers/batch", async (req, res) => {
  const { subscribers } = req.body;
  if (!Array.isArray(subscribers) || subscribers.length === 0) {
    return res.status(400).json({ error: "Dữ liệu không hợp lệ" });
  }

  try {
    let sql = "INSERT OR REPLACE INTO subscribers (last9Digits, fullPhoneNumber, status, updatedBy) VALUES ";
    const params: any[] = [];
    const placeholders = subscribers.map(s => {
      params.push(s.last9Digits, s.fullPhoneNumber, s.status, s.updatedBy);
      return "(?, ?, ?, ?)";
    });
    sql += placeholders.join(", ");
    
    await queryD1(sql, params);
    res.json({ success: true, count: subscribers.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Reset Database
app.post("/api/admin/reset-db", async (req, res) => {
  try {
    await queryD1("DROP TABLE IF EXISTS subscribers");
    await queryD1(`
      CREATE TABLE subscribers (
        last9Digits TEXT PRIMARY KEY,
        fullPhoneNumber TEXT,
        status TEXT,
        updatedBy TEXT
      )
    `);
    res.json({ success: true, message: "Đã làm mới cơ sở dữ liệu." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
