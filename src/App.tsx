import { useState, useEffect, useCallback, FormEvent } from "react";
import { Search, Settings, RefreshCw, CheckCircle2, AlertCircle, Phone, Lock, LogOut, Database, Table, User } from "lucide-react";
import Papa from "papaparse";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion, AnimatePresence } from "motion/react";

// Types
interface SubscriberData {
  last9Digits: string;
  fullPhoneNumber: string;
  status: string;
}

interface AppConfig {
  sheetUrl: string;
  phoneColumn: string;
  statusColumn: string;
  adminPassword?: string;
}

export default function App() {
  // Auth State
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");

  // Config State
  const [config, setConfig] = useState<AppConfig>({
    sheetUrl: "",
    phoneColumn: "",
    statusColumn: ""
  });
  const [headers, setHeaders] = useState<string[]>([]);
  
  // App State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SubscriberData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Initial Load: Fetch Config from Cloudflare
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          if (data && data.sheetUrl) {
            setConfig(data);
          }
        }
      } catch (err) {
        console.error("Failed to fetch config:", err);
      }
    };
    fetchConfig();
  }, []);

  // Helper: Extract Last 9 Digits
  const getLast9Digits = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    return cleaned.slice(-9);
  };

  // Helper: Extract Sheet ID
  const getSheetId = (url: string) => {
    const match = url.match(/\/d\/(.*?)(\/|$)/);
    return match ? match[1] : null;
  };

  // Admin Password Verification
  const verifyAdminPassword = (e: FormEvent) => {
    e.preventDefault();
    if (adminPasswordInput === (config.adminPassword || "admin")) {
      setIsAdminVerified(true);
      setAdminPasswordInput("");
      setError(null);
    } else {
      setError("Mật khẩu Admin không chính xác.");
    }
  };

  // Read Headers from Sheet
  const readHeaders = async () => {
    const sheetId = getSheetId(config.sheetUrl);
    if (!sheetId) {
      setError("Link Google Sheet không hợp lệ. Vui lòng sử dụng link có dạng /d/ID_SHEET/");
      return;
    }

    setIsLoading(true);
    setError(null);
    setHeaders([]);

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&usp=sharing`;
      const response = await fetch(csvUrl);
      
      // Check if response is HTML (usually means it's a login page because sheet is private)
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        setError("Lỗi: Không thể đọc dữ liệu. Vui lòng kiểm tra lại quyền chia sẻ của Google Sheet (Phải đặt là 'Bất kỳ ai có liên kết đều có thể xem').");
        setIsLoading(false);
        return;
      }

      const csvText = await response.text();
      
      if (csvText.startsWith("<!DOCTYPE html>")) {
        setError("Lỗi: Google Sheet đang trả về trang web thay vì dữ liệu. Hãy đảm bảo bạn đã chia sẻ Sheet công khai.");
        setIsLoading(false);
        return;
      }

      Papa.parse(csvText, {
        header: false,
        preview: 1,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            const rawHeaders = results.data[0] as string[];
            // Filter out empty or invalid headers
            const cleanHeaders = rawHeaders.filter(h => h && h.trim() !== "");
            if (cleanHeaders.length === 0) {
              setError("Không tìm thấy tiêu đề cột hợp lệ trong Sheet.");
            } else {
              setHeaders(cleanHeaders);
            }
          } else {
            setError("Sheet không có dữ liệu.");
          }
          setIsLoading(false);
        },
        error: (err: any) => {
          setError("Lỗi phân tích CSV: " + err.message);
          setIsLoading(false);
        }
      });
    } catch (err) {
      setError("Không thể kết nối với Google Sheet. Vui lòng kiểm tra kết nối mạng.");
      setIsLoading(false);
    }
  };

  // Save Config Only
  const handleSaveOnly = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      
      if (!response.ok) {
        const text = await response.text();
        let errorMessage = `Lỗi Server (${response.status})`;
        try {
          const json = JSON.parse(text);
          errorMessage = json.error || errorMessage;
        } catch (e) {
          // Nếu không phải JSON, có thể là lỗi HTML từ Vercel
          if (text.includes("404")) errorMessage = "Lỗi 404: Không tìm thấy đường dẫn API. Kiểm tra vercel.json";
          else if (text.includes("500")) errorMessage = "Lỗi 500: Server gặp sự cố. Kiểm tra Logs trên Vercel";
          else errorMessage = text.substring(0, 100); // Lấy 100 ký tự đầu của lỗi
        }
        throw new Error(errorMessage);
      }
      
      setSuccess("Đã lưu cấu hình thành công.");
    } catch (err: any) {
      setError("Lỗi lưu cấu hình: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Import Data to Cloudflare
  const handleImport = async () => {
    const sheetId = getSheetId(config.sheetUrl);
    if (!sheetId) {
      setError("Link Google Sheet không hợp lệ hoặc chưa được thiết lập.");
      return;
    }

    if (!config.phoneColumn || !config.statusColumn) {
      setError("Cấu hình cột dữ liệu chưa hoàn thiện. Vui lòng liên hệ Admin.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&usp=sharing`;
      const response = await fetch(csvUrl);
      
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        setError("Lỗi: Không thể tải dữ liệu từ Google Sheet. Hãy kiểm tra lại quyền chia sẻ.");
        setIsLoading(false);
        return;
      }

      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const rows = results.data as any[];
          if (rows.length === 0) {
            setError("Không có dữ liệu trong Sheet.");
            setIsLoading(false);
            return;
          }

          try {
            let count = 0;
            const chunks = [];
            for (let i = 0; i < rows.length; i += 30) {
              chunks.push(rows.slice(i, i + 30));
            }

            for (const chunk of chunks) {
              const subscribers = chunk.map(row => {
                const phone = row[config.phoneColumn];
                const status = row[config.statusColumn];
                if (phone) {
                  const last9 = getLast9Digits(String(phone));
                  count++;
                  return {
                    last9Digits: last9,
                    fullPhoneNumber: String(phone),
                    status: String(status || "N/A")
                  };
                }
                return null;
              }).filter(s => s !== null);

              if (subscribers.length > 0) {
                const res = await fetch("/api/subscribers/batch", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ subscribers })
                });
                if (!res.ok) throw new Error("Lỗi khi gửi dữ liệu lên Cloudflare");
              }
            }

            // Save config
            if (isAdminVerified) {
              await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config)
              });
            }
            
            setSuccess(`Đã cập nhật thành công ${count} bản ghi lên Cloudflare D1.`);
          } catch (err: any) {
            console.error("Import error:", err);
            setError("Lỗi cập nhật dữ liệu: " + (err.message || "Vui lòng kiểm tra lại kết nối Cloudflare."));
          } finally {
            setIsLoading(false);
          }
        },
        error: (err: any) => {
          setError("Lỗi xử lý dữ liệu: " + err.message);
          setIsLoading(false);
        }
      });
    } catch (err: any) {
      setError("Lỗi kết nối: " + err.message);
      setIsLoading(false);
    }
  };

  // Search Logic
  const handleSearch = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResult(null);
    setError(null);

    const last9 = getLast9Digits(searchQuery);
    if (last9.length < 9) {
      setError("Số điện thoại không hợp lệ (cần ít nhất 9 chữ số).");
      setIsSearching(false);
      return;
    }

    try {
      const response = await fetch(`/api/subscribers/${last9}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResult(data);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || "Không tìm thấy thông tin cho số thuê bao này.");
      }
    } catch (err: any) {
      setError("Lỗi tra cứu: " + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100">
      {/* Header */}
      <header className="bg-blue-600 text-white py-8 px-4 shadow-lg">
        <div className="max-w-4xl mx-auto text-center">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl md:text-4xl font-bold tracking-tight uppercase"
          >
            Tra cứu kết quả cập nhật thông tin thuê bao
          </motion.h1>
          <p className="mt-2 text-blue-100 opacity-80">Hệ thống tra cứu thông tin di động Vinaphone</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 md:p-8 -mt-6">
        <div className="space-y-6">
          
          {/* Search Module */}
          <Card className="border-none shadow-xl overflow-hidden">
            <CardHeader className="bg-white border-b border-slate-100">
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle className="text-xl text-blue-700 flex items-center gap-2">
                    <Search className="w-5 h-5" />
                    Tra cứu thông tin
                  </CardTitle>
                  <CardDescription>Nhập số điện thoại để kiểm tra trạng thái (so khớp 9 số cuối)</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input 
                    placeholder="Ví dụ: 0912345678" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-12 text-lg border-slate-200 focus:ring-blue-500"
                  />
                </div>
                <Button type="submit" className="h-12 px-8 bg-blue-600 hover:bg-blue-700" disabled={isSearching}>
                  {isSearching ? "Đang tìm..." : "Tìm kiếm"}
                </Button>
              </form>

              <AnimatePresence mode="wait">
                {searchResult && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="mt-6"
                  >
                    <Alert className="bg-green-50 border-green-200 text-green-800">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <AlertTitle className="text-lg font-bold">Kết quả tìm thấy!</AlertTitle>
                      <AlertDescription className="mt-2 space-y-2">
                        <div className="flex justify-between border-b border-green-100 pb-2">
                          <span className="opacity-70">Số thuê bao:</span>
                          <span className="font-mono font-bold">{searchResult.fullPhoneNumber}</span>
                        </div>
                        <div className="flex justify-between border-b border-green-100 pb-2">
                          <span className="opacity-70">Mã so khớp (9 số cuối):</span>
                          <span className="font-mono">{searchResult.last9Digits}</span>
                        </div>
                        <div className="flex justify-between pt-1">
                          <span className="opacity-70">Trạng thái:</span>
                          <span className="font-bold text-green-700">{searchResult.status}</span>
                        </div>
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}

                {error && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-4"
                  >
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Thông báo</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}

                {success && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-4"
                  >
                    <Alert className="bg-blue-50 border-blue-200 text-blue-800">
                      <CheckCircle2 className="h-4 w-4 text-blue-600" />
                      <AlertTitle>Thành công</AlertTitle>
                      <AlertDescription>{success}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Admin Section */}
          <div className="pt-8">
            {!isAdminVerified ? (
              <Card className="max-w-md mx-auto shadow-lg border-blue-100">
                <CardHeader>
                  <CardTitle className="text-center flex items-center justify-center gap-2">
                    <Lock className="w-5 h-5 text-blue-600" />
                    Đăng nhập Admin
                  </CardTitle>
                  <CardDescription className="text-center">Nhập mật khẩu hệ thống để quản lý dữ liệu</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={verifyAdminPassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Mật khẩu Admin</Label>
                      <Input 
                        type="password" 
                        value={adminPasswordInput}
                        onChange={(e) => setAdminPasswordInput(e.target.value)}
                        placeholder="Nhập mật khẩu"
                        autoFocus
                      />
                    </div>
                    <Button type="submit" className="w-full bg-blue-600">Xác nhận</Button>
                  </form>
                </CardContent>
                <CardFooter className="justify-center border-t border-slate-50 pt-4">
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest">Secure Admin Access</p>
                </CardFooter>
              </Card>
            ) : (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="border-2 border-blue-100 shadow-lg">
                  <CardHeader className="bg-blue-50/50">
                    <div className="flex justify-between items-center">
                      <div>
                        <CardTitle className="text-slate-800 flex items-center gap-2">
                          <Settings className="w-5 h-5 text-blue-600" />
                          Cấu hình dữ liệu (Admin)
                        </CardTitle>
                        <CardDescription>Thiết lập nguồn dữ liệu và mật khẩu hệ thống</CardDescription>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setIsAdminVerified(false)} className="text-slate-500">
                        <LogOut className="w-4 h-4 mr-2" />
                        Thoát Admin
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-6">
                    {/* Password Config */}
                    <div className="space-y-2 p-4 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex justify-between items-center">
                        <Label className="flex items-center gap-2">
                          <Lock className="w-4 h-4" />
                          Đổi mật khẩu Admin (Lưu vào CSDL)
                        </Label>
                        <Button variant="outline" size="sm" onClick={handleSaveOnly} disabled={isLoading}>
                          Lưu mật khẩu
                        </Button>
                      </div>
                      <Input 
                        type="password"
                        placeholder="Mật khẩu mới"
                        value={config.adminPassword || ""}
                        onChange={(e) => setConfig({...config, adminPassword: e.target.value})}
                      />
                    </div>

                    {/* Sheet Config */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="flex items-center gap-2">
                            <Database className="w-4 h-4" />
                            Link Google Sheet
                          </Label>
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-orange-600">
                            <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                            Cloudflare D1 Mode
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Input 
                            placeholder="https://docs.google.com/spreadsheets/d/..." 
                            value={config.sheetUrl}
                            onChange={(e) => setConfig({...config, sheetUrl: e.target.value})}
                          />
                          <Button variant="secondary" onClick={readHeaders} disabled={isLoading || !config.sheetUrl}>
                            {isLoading ? "Đang đọc..." : "Đọc tiêu đề"}
                          </Button>
                        </div>
                      </div>

                      {headers.length > 0 && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-blue-50/30 rounded-lg border border-blue-100">
                          <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                              <Phone className="w-4 h-4" />
                              Cột Số thuê bao
                            </Label>
                            <select 
                              className="w-full h-10 px-3 py-2 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={config.phoneColumn}
                              onChange={(e) => setConfig({...config, phoneColumn: e.target.value})}
                            >
                              <option value="">-- Chọn cột --</option>
                              {headers.map((h, idx) => <option key={`phone-${h}-${idx}`} value={h}>{h}</option>)}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                              <Table className="w-4 h-4" />
                              Cột Kết quả cập nhật
                            </Label>
                            <select 
                              className="w-full h-10 px-3 py-2 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={config.statusColumn}
                              onChange={(e) => setConfig({...config, statusColumn: e.target.value})}
                            >
                              <option value="">-- Chọn cột --</option>
                              {headers.map((h, idx) => <option key={`status-${h}-${idx}`} value={h}>{h}</option>)}
                            </select>
                          </div>
                        </motion.div>
                      )}
                    </div>

                    <div className="flex gap-4">
                      <Button onClick={handleImport} className="flex-1 bg-slate-800 hover:bg-slate-900 h-12 text-lg" disabled={isLoading}>
                        {isLoading ? (
                          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                        ) : (
                          <Database className="w-5 h-5 mr-2" />
                        )}
                        Import dữ liệu từ Sheet
                      </Button>
                      <Button onClick={handleSaveOnly} variant="outline" className="h-12 px-6 border-slate-200" disabled={isLoading}>
                        Lưu cấu hình
                      </Button>
                    </div>
                  </CardContent>
                  <CardFooter className="text-xs text-slate-400 border-t border-slate-100 pt-4">
                    Hệ thống quản trị dữ liệu
                  </CardFooter>
                </Card>
              </motion.div>
            )}
          </div>
        </div>
      </main>

      <footer className="mt-12 py-8 text-center text-slate-400 text-sm border-t border-slate-200">
        <p>© 2026 Vinaphone Subscriber Lookup System</p>
        <p className="mt-1">Hệ thống sử dụng Cloudflare D1 Database</p>
      </footer>
    </div>
  );
}
