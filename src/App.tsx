import { useState, useEffect, useCallback, FormEvent } from "react";
import { Search, Settings, RefreshCw, CheckCircle2, AlertCircle, Phone, Lock, LogOut } from "lucide-react";
import Papa from "papaparse";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion, AnimatePresence } from "motion/react";

// Types
interface SubscriberData {
  phoneNumber: string;
  status: string;
  [key: string]: string;
}

export default function App() {
  // State
  const [sheetUrl, setSheetUrl] = useState<string>(() => localStorage.getItem("vinaphone_sheet_url") || "");
  const [data, setData] = useState<SubscriberData[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SubscriberData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Admin State
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  // Constants
  const ADMIN_PASSWORD = "admin"; // Default password for simplicity

  // Helper: Extract Sheet ID
  const getSheetId = (url: string) => {
    const match = url.match(/\/d\/(.*?)(\/|$)/);
    return match ? match[1] : null;
  };

  // Fetch Data from Google Sheet
  const fetchData = useCallback(async (url: string) => {
    if (!url) return;
    
    const sheetId = getSheetId(url);
    if (!sheetId) {
      setError("Link Google Sheet không hợp lệ. Vui lòng kiểm tra lại.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const response = await fetch(csvUrl);
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsedData = results.data as any[];
          const formattedData: SubscriberData[] = parsedData.map((row) => {
            const keys = Object.keys(row);
            return {
              phoneNumber: row[keys[0]] || "", // Column A
              status: row[keys[1]] || "Đã cập nhật", // Column B or default
              ...row
            };
          });
          
          setData(formattedData);
          localStorage.setItem("vinaphone_cached_data", JSON.stringify(formattedData));
          setIsLoading(false);
        },
        error: (err: any) => {
          setError("Lỗi khi phân tích dữ liệu: " + err.message);
          setIsLoading(false);
        }
      });
    } catch (err) {
      setError("Không thể kết nối với Google Sheet. Hãy đảm bảo Sheet đã được chia sẻ công khai.");
      setIsLoading(false);
    }
  }, []);

  // Initial Load
  useEffect(() => {
    const cached = localStorage.getItem("vinaphone_cached_data");
    if (cached) {
      setData(JSON.parse(cached));
    } else if (sheetUrl) {
      fetchData(sheetUrl);
    }
  }, [sheetUrl, fetchData]);

  // Search Logic
  const handleSearch = (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    // Simulate a small delay for better UX
    setTimeout(() => {
      const result = data.find(item => 
        item.phoneNumber.replace(/\s/g, "").includes(searchQuery.replace(/\s/g, ""))
      );
      setSearchResult(result || null);
      setIsSearching(false);
      if (!result) {
        setError("Không tìm thấy thông tin cho số thuê bao này.");
      } else {
        setError(null);
      }
    }, 300);
  };

  // Admin Login
  const handleAdminLogin = (e: FormEvent) => {
    e.preventDefault();
    if (adminPassword === ADMIN_PASSWORD) {
      setIsAdmin(true);
      setShowAdminLogin(false);
      setAdminPassword("");
      setError(null);
    } else {
      setError("Mật khẩu Admin không chính xác.");
    }
  };

  // Save Config
  const handleSaveConfig = () => {
    localStorage.setItem("vinaphone_sheet_url", sheetUrl);
    fetchData(sheetUrl);
    setError(null);
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
                  <CardDescription>Nhập số điện thoại để kiểm tra trạng thái</CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => fetchData(sheetUrl)}
                  disabled={isLoading || !sheetUrl}
                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                  Cập nhật dữ liệu
                </Button>
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
                          <span className="font-mono font-bold">{searchResult.phoneNumber}</span>
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
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Admin Module (Conditional) */}
          {isAdmin ? (
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
              <Card className="border-2 border-blue-100 shadow-lg bg-blue-50/30">
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-slate-800 flex items-center gap-2">
                      <Settings className="w-5 h-5 text-blue-600" />
                      Cấu hình dữ liệu (Admin)
                    </CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setIsAdmin(false)} className="text-slate-500">
                      <LogOut className="w-4 h-4 mr-2" />
                      Thoát Admin
                    </Button>
                  </div>
                  <CardDescription>Thiết lập nguồn dữ liệu từ Google Sheets</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="sheet-url">Link Google Sheet</Label>
                    <Input 
                      id="sheet-url"
                      placeholder="https://docs.google.com/spreadsheets/d/..." 
                      value={sheetUrl}
                      onChange={(e) => setSheetUrl(e.target.value)}
                      className="bg-white"
                    />
                    <p className="text-xs text-slate-500">
                      Lưu ý: Sheet phải được đặt ở chế độ "Bất kỳ ai có liên kết đều có thể xem".
                    </p>
                  </div>
                  <Button onClick={handleSaveConfig} className="w-full bg-slate-800 hover:bg-slate-900">
                    Lưu cấu hình & Tải lại dữ liệu
                  </Button>
                </CardContent>
                <CardFooter className="text-xs text-slate-400 border-t border-blue-100 pt-4">
                  Dữ liệu hiện tại: {data.length} bản ghi
                </CardFooter>
              </Card>
            </motion.div>
          ) : (
            <div className="flex justify-center">
              {!showAdminLogin ? (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowAdminLogin(true)}
                  className="text-slate-400 hover:text-blue-600"
                >
                  <Lock className="w-3 h-3 mr-2" />
                  Admin Login
                </Button>
              ) : (
                <Card className="w-full max-w-sm shadow-md">
                  <CardHeader className="py-4">
                    <CardTitle className="text-sm">Xác thực Admin</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <form onSubmit={handleAdminLogin} className="flex gap-2">
                      <Input 
                        type="password" 
                        placeholder="Mật khẩu" 
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className="h-9"
                        autoFocus
                      />
                      <Button type="submit" size="sm" className="h-9">Vào</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdminLogin(false)} className="h-9">Hủy</Button>
                    </form>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="mt-12 py-8 text-center text-slate-400 text-sm border-t border-slate-200">
        <p>© 2026 Vinaphone Subscriber Lookup System</p>
        <p className="mt-1">Dữ liệu được cập nhật trực tiếp từ Google Sheets</p>
      </footer>
    </div>
  );
}
