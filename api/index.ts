import express from "express";
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

// API: Health Check
app.get("/api/ping", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "API is working on Vercel!",
    env_check: {
      has_account: !!process.env.CLOUDFLARE_ACCOUNT_ID,
      has_database: !!process.env.CLOUDFLARE_DATABASE_ID,
      has_token: !!process.env.CLOUDFLARE_API_TOKEN
    }
  });
});

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
    console.error("Settings Get Error:", error);
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
    console.error("Settings Save Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API: Search Subscriber
app.get("/api/subscribers/:last9", async (req, res) => {
  try {
    const result = await queryD1(
      "SELECT * FROM subscribers WHERE last9Digits = ? ORDER BY status ASC",
      [req.params.last9]
    );
    // Return all results as an array
    if (result && result.results) {
      res.json(result.results);
    } else {
      res.status(404).json({ error: "Không tìm thấy thông tin cho số thuê bao này." });
    }
  } catch (error: any) {
    console.error("Search Error:", error);
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
    // Change to simple INSERT to allow duplicates
    let sql = "INSERT INTO subscribers (last9Digits, fullPhoneNumber, status, updatedBy) VALUES ";
    const params: any[] = [];
    const placeholders = subscribers.map(s => {
      const last9 = String(s.last9Digits || "");
      const phone = String(s.fullPhoneNumber || "");
      const status = String(s.status || "N/A");
      const updatedBy = String(s.updatedBy || "N/A");
      
      params.push(last9, phone, status, updatedBy);
      return "(?, ?, ?, ?)";
    });
    sql += placeholders.join(", ");
    
    await queryD1(sql, params);
    res.json({ success: true, count: subscribers.length });
  } catch (error: any) {
    console.error("Batch Import Error:", error);
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

// API: Reset Database (Emergency/Migration)
app.post("/api/admin/reset-db", async (req, res) => {
  try {
    // Sequence of commands to rebuild table
    await queryD1("DROP TABLE IF EXISTS subscribers");
    await queryD1(`
      CREATE TABLE subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        last9Digits TEXT,
        fullPhoneNumber TEXT,
        status TEXT,
        updatedBy TEXT
      )
    `);
    await queryD1("CREATE INDEX idx_last9 ON subscribers(last9Digits)");
    
    res.json({ success: true, message: "Đã làm mới cơ sở dữ liệu thành công." });
  } catch (error: any) {
    console.error("Reset DB Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Global Error Handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Global Error:", err);
  res.status(500).json({ error: "Internal Server Error: " + err.message });
});

export default app;

// Dev Server logic (only runs locally)
if (process.env.NODE_ENV !== "production" && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = 3000;
  const startDev = async () => {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Dev server running on http://localhost:${PORT}`);
      });
    } catch (e) {
      console.error("Failed to start dev server:", e);
    }
  };
  startDev();
}
