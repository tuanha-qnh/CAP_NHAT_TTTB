import { useState, useEffect, useCallback, FormEvent } from "react";
import { Search, Settings, RefreshCw, CheckCircle2, AlertCircle, Phone, Lock, LogOut, Database, Table, User } from "lucide-react";
import Papa from "papaparse";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion, AnimatePresence } from "motion/react";

// Firebase
import { db, auth } from "./firebase";
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  collection, 
  writeBatch,
  getDocs,
  query,
  where,
  limit
} from "firebase/firestore";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from "firebase/auth";

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
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
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

  // Listen for Auth Changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      // Reset verification if user changes
      setIsAdminVerified(false);
    });
    return () => unsubscribe();
  }, []);

  // Listen for Config Changes
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "settings", "main"), (snapshot) => {
      if (snapshot.exists()) {
        setConfig(snapshot.data() as AppConfig);
      }
    });
    return () => unsubscribe();
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

  // Admin Login (Google)
  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setError(null);
    } catch (err: any) {
      setError("Lỗi đăng nhập: " + err.message);
    }
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
      setError("Link Google Sheet không hợp lệ.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const response = await fetch(csvUrl);
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: false,
        preview: 1,
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            setHeaders(results.data[0] as string[]);
          }
          setIsLoading(false);
        },
        error: (err: any) => {
          setError("Lỗi đọc tiêu đề: " + err.message);
          setIsLoading(false);
        }
      });
    } catch (err) {
      setError("Không thể kết nối với Google Sheet.");
      setIsLoading(false);
    }
  };

  // Import Data to Firestore
  const handleImport = async () => {
    if (!config.phoneColumn || !config.statusColumn) {
      setError("Vui lòng chọn trường dữ liệu để import.");
      return;
    }

    const sheetId = getSheetId(config.sheetUrl);
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const response = await fetch(csvUrl);
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const rows = results.data as any[];
          let count = 0;
          
          // Firestore Batch Write (Max 500 per batch)
          const chunks = [];
          for (let i = 0; i < rows.length; i += 500) {
            chunks.push(rows.slice(i, i + 500));
          }

          for (const chunk of chunks) {
            const batch = writeBatch(db);
            for (const row of chunk) {
              const phone = row[config.phoneColumn];
              const status = row[config.statusColumn];
              
              if (phone) {
                const last9 = getLast9Digits(phone);
                const docRef = doc(db, "subscribers", last9);
                batch.set(docRef, {
                  last9Digits: last9,
                  fullPhoneNumber: phone,
                  status: status || "N/A"
                });
                count++;
              }
            }
            await batch.commit();
          }

          // Save Config
          await setDoc(doc(db, "settings", "main"), config);
          
          setSuccess(`Đã import thành công ${count} bản ghi.`);
          setIsLoading(false);
        }
      });
    } catch (err: any) {
      setError("Lỗi import: " + err.message);
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
      const docRef = doc(db, "subscribers", last9);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setSearchResult(docSnap.data() as SubscriberData);
      } else {
        setError("Không tìm thấy thông tin cho số thuê bao này.");
      }
    } catch (err: any) {
      setError("Lỗi tra cứu: " + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const isUserAdmin = user?.email === "tuanha.qnh@gmail.com";

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
            {!user ? (
              <div className="flex justify-center">
                <Button variant="outline" onClick={handleGoogleLogin} className="gap-2">
                  <User className="w-4 h-4" />
                  Đăng nhập Admin (Google)
                </Button>
              </div>
            ) : !isUserAdmin ? (
              <div className="text-center space-y-2">
                <p className="text-slate-500">Bạn không có quyền truy cập Admin.</p>
                <Button variant="ghost" size="sm" onClick={() => signOut(auth)}>Đăng xuất</Button>
              </div>
            ) : !isAdminVerified ? (
              <Card className="max-w-md mx-auto shadow-lg border-blue-100">
                <CardHeader>
                  <CardTitle className="text-center flex items-center justify-center gap-2">
                    <Lock className="w-5 h-5 text-blue-600" />
                    Xác thực mật khẩu Admin
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={verifyAdminPassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Nhập mật khẩu để tiếp tục</Label>
                      <Input 
                        type="password" 
                        value={adminPasswordInput}
                        onChange={(e) => setAdminPasswordInput(e.target.value)}
                        placeholder="Mật khẩu"
                        autoFocus
                      />
                    </div>
                    <Button type="submit" className="w-full bg-blue-600">Xác nhận</Button>
                    <Button type="button" variant="ghost" className="w-full" onClick={() => signOut(auth)}>Đăng xuất</Button>
                  </form>
                </CardContent>
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
                        Khóa Admin
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-6">
                    {/* Password Config */}
                    <div className="space-y-2 p-4 bg-slate-50 rounded-lg border border-slate-100">
                      <Label className="flex items-center gap-2">
                        <Lock className="w-4 h-4" />
                        Đổi mật khẩu Admin
                      </Label>
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
                        <Label className="flex items-center gap-2">
                          <Database className="w-4 h-4" />
                          Link Google Sheet
                        </Label>
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
                              {headers.map(h => <option key={h} value={h}>{h}</option>)}
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
                              {headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </div>
                        </motion.div>
                      )}
                    </div>

                    <Button onClick={handleImport} className="w-full bg-slate-800 hover:bg-slate-900 h-12 text-lg" disabled={isLoading}>
                      {isLoading ? (
                        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                      ) : (
                        <Database className="w-5 h-5 mr-2" />
                      )}
                      Lưu cấu hình & Import dữ liệu vào CSDL
                    </Button>
                  </CardContent>
                  <CardFooter className="text-xs text-slate-400 border-t border-slate-100 pt-4">
                    Admin: {user.email}
                  </CardFooter>
                </Card>
              </motion.div>
            )}
          </div>
        </div>
      </main>

      <footer className="mt-12 py-8 text-center text-slate-400 text-sm border-t border-slate-200">
        <p>© 2026 Vinaphone Subscriber Lookup System</p>
        <p className="mt-1">Hệ thống sử dụng Firebase Cloud Database</p>
      </footer>
    </div>
  );
}
