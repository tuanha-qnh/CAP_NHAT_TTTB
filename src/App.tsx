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
  updatedBy: string;
}

interface SourceConfig {
  sheetUrl: string;
  phoneColumn: string;
  statusColumn: string;
  updatedByUserColumn: string;
}

interface AppConfig {
  sources: {
    main: SourceConfig;
    invalidDocs: SourceConfig;
    id9Digits: SourceConfig;
    others: SourceConfig;
  };
  adminPassword?: string;
}

const DEFAULT_SOURCE_CONFIG: SourceConfig = {
  sheetUrl: "",
  phoneColumn: "",
  statusColumn: "",
  updatedByUserColumn: ""
};

export default function App() {
  // Auth State
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");

  // Config State
  const [config, setConfig] = useState<AppConfig>({
    sources: {
      main: { ...DEFAULT_SOURCE_CONFIG },
      invalidDocs: { ...DEFAULT_SOURCE_CONFIG },
      id9Digits: { ...DEFAULT_SOURCE_CONFIG },
      others: { ...DEFAULT_SOURCE_CONFIG }
    },
    adminPassword: ""
  });
  
  const [headersMap, setHeadersMap] = useState<Record<string, string[]>>({
    main: [],
    invalidDocs: [],
    id9Digits: [],
    others: []
  });
  
  // App State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SubscriberData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
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
          if (data && data.sources) {
            setConfig(data);
          } else if (data && data.sheetUrl) {
            // Migration logic for old config format
            setConfig({
              sources: {
                main: {
                  sheetUrl: data.sheetUrl || "",
                  phoneColumn: data.phoneColumn || "",
                  statusColumn: data.statusColumn || "",
                  updatedByUserColumn: data.updatedByUserColumn || ""
                },
                invalidDocs: { ...DEFAULT_SOURCE_CONFIG },
                id9Digits: { ...DEFAULT_SOURCE_CONFIG },
                others: { ...DEFAULT_SOURCE_CONFIG }
              },
              adminPassword: data.adminPassword || ""
            });
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
  const readHeaders = async (sourceKey: keyof AppConfig['sources']) => {
    const source = config.sources[sourceKey];
    const sheetId = getSheetId(source.sheetUrl);
    if (!sheetId) {
      setError(`Link Google Sheet của module ${sourceKey} không hợp lệ.`);
      return;
    }

    setLoadingMap(prev => ({ ...prev, [sourceKey]: true }));
    setError(null);
    setHeadersMap(prev => ({ ...prev, [sourceKey]: [] }));

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&usp=sharing`;
      const response = await fetch(csvUrl);
      
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        setError(`Lỗi: Không thể đọc dữ liệu ${sourceKey}. Vui lòng kiểm tra quyền chia sẻ của Google Sheet.`);
        setLoadingMap(prev => ({ ...prev, [sourceKey]: false }));
        return;
      }

      const csvText = await response.text();
      Papa.parse(csvText, {
        header: false,
        preview: 1,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            const rawHeaders = results.data[0] as string[];
            const cleanHeaders = rawHeaders.filter(h => h && h.trim() !== "");
            if (cleanHeaders.length === 0) {
              setError(`Không tìm thấy tiêu đề cột hợp lệ trong Sheet của ${sourceKey}.`);
            } else {
              setHeadersMap(prev => ({ ...prev, [sourceKey]: cleanHeaders }));
            }
          } else {
            setError(`Sheet của ${sourceKey} không có dữ liệu.`);
          }
          setLoadingMap(prev => ({ ...prev, [sourceKey]: false }));
        },
        error: (err: any) => {
          setError(`Lỗi phân tích CSV (${sourceKey}): ` + err.message);
          setLoadingMap(prev => ({ ...prev, [sourceKey]: false }));
        }
      });
    } catch (err) {
      setError(`Không thể kết nối với Google Sheet của ${sourceKey}.`);
      setLoadingMap(prev => ({ ...prev, [sourceKey]: false }));
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
        throw new Error("Lỗi khi lưu cấu hình lên Server.");
      }
      
      setSuccess("Đã lưu cấu hình thành công.");
    } catch (err: any) {
      setError("Lỗi lưu cấu hình: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Import Data to Cloudflare
  const handleImport = async (sourceKey: keyof AppConfig['sources']): Promise<number> => {
    const source = config.sources[sourceKey];
    const sheetId = getSheetId(source.sheetUrl);
    
    if (!sheetId || !source.phoneColumn || !source.statusColumn || !source.updatedByUserColumn) {
      console.log(`Bỏ qua module ${sourceKey} do chưa cấu hình đầy đủ.`);
      return 0;
    }

    setLoadingMap(prev => ({ ...prev, [sourceKey]: true }));

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&usp=sharing`;
      const response = await fetch(csvUrl);
      const csvText = await response.text();
      
      return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: async (results) => {
            const rows = results.data as any[];
            if (rows.length === 0) {
              setLoadingMap(prev => ({ ...prev, [sourceKey]: false }));
              return resolve(0);
            }

            // Helper to get value from row with flexible key matching
            const getRowValue = (row: any, colName: string) => {
              if (!colName) return "N/A";
              const val = row[colName];
              if (val !== undefined && val !== null && String(val).trim() !== "") return String(val).trim();
              const target = colName.trim().toLowerCase();
              const actualKey = Object.keys(row).find(k => k.trim().toLowerCase() === target);
              if (actualKey) {
                const val2 = row[actualKey];
                if (val2 !== undefined && val2 !== null && String(val2).trim() !== "") return String(val2).trim();
              }
              return "N/A";
            };

            try {
              let count = 0;
              const chunks = [];
              for (let i = 0; i < rows.length; i += 15) {
                chunks.push(rows.slice(i, i + 15));
              }

              for (const chunk of chunks) {
                const subscribers = chunk.map(row => {
                  const phone = getRowValue(row, source.phoneColumn);
                  const status = getRowValue(row, source.statusColumn);
                  const updatedBy = getRowValue(row, source.updatedByUserColumn);
                  
                  if (phone && phone !== "N/A") {
                    const last9 = getLast9Digits(phone);
                    count++;
                    return {
                      last9Digits: last9,
                      fullPhoneNumber: phone,
                      status: status,
                      updatedBy: updatedBy
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
                  if (!res.ok) throw new Error(`Lỗi đồng bộ nguồn ${sourceKey}`);
                }
              }
              setLoadingMap(prev => ({ ...prev, [sourceKey]: false }));
              resolve(count);
            } catch (err) {
              setLoadingMap(prev => ({ ...prev, [sourceKey]: false }));
              reject(err);
            }
          }
        });
      });
    } catch (err: any) {
      setLoadingMap(prev => ({ ...prev, [sourceKey]: false }));
      throw err;
    }
  };

  // Import All Sources
  const handleImportAll = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    
    let totalCount = 0;
    const sourceKeys: (keyof AppConfig['sources'])[] = ['main', 'invalidDocs', 'id9Digits', 'others'];
    
    try {
      for (const key of sourceKeys) {
        setSuccess(`Đang xử lý: ${key === 'main' ? 'Tập mặc định' : key === 'invalidDocs' ? 'Sai giấy tờ' : key === 'id9Digits' ? 'CMND 9 số' : 'Khác'}...`);
        const count = await handleImport(key);
        totalCount += count;
      }
      
      if (totalCount > 0) {
        setSuccess(`Thành công! Tổng cộng đã import ${totalCount} bản ghi từ các nguồn.`);
      } else {
        setError("Không có dữ liệu nào được import. Vui lòng kiểm tra lại cấu hình các nguồn.");
      }
    } catch (err: any) {
      setError("Quá trình import bị gián đoạn: " + err.message);
    } finally {
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

              <p className="mt-3 text-red-600 text-sm font-medium flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <strong>Lưu ý:</strong> Chỉ nhập các số điện thoại nằm trong danh sách phân giao về cho đơn vị thực hiện. <strong>KHÔNG NHẬP</strong> các số nằm ngoài danh sách.
                </span>
              </p>

              <AnimatePresence mode="wait">
                {searchResult && (
                  <motion.div 
                    key="search-result"
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
                          <span className="opacity-70">User cập nhật:</span>
                          <span className="font-medium">{searchResult.updatedBy}</span>
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
                    key="error-alert"
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
                    key="success-alert"
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
                  <CardContent className="space-y-8 pt-6">
                    {/* Password Config */}
                    <div className="space-y-2 p-4 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex justify-between items-center">
                        <Label className="flex items-center gap-2">
                          <Lock className="w-4 h-4" />
                          Đổi mật khẩu Admin (Lưu vào CSDL)
                        </Label>
                        <Button variant="outline" size="sm" onClick={handleSaveOnly} disabled={isLoading}>
                          {isLoading ? "Đang lưu..." : "Lưu mật khẩu"}
                        </Button>
                      </div>
                      <Input 
                        type="password"
                        placeholder="Mật khẩu mới"
                        value={config.adminPassword || ""}
                        onChange={(e) => setConfig({...config, adminPassword: e.target.value})}
                      />
                    </div>

                    {/* Import Modules */}
                    <div className="space-y-10">
                      {(Object.entries({
                        main: "Tập thuê bao mặc định",
                        invalidDocs: "Tập thuê bao sai giấy tờ",
                        id9Digits: "Tập thuê bao CMND 9 số",
                        others: "Tập thuê bao khác"
                      }) as [keyof AppConfig['sources'], string][]).map(([key, label]) => (
                        <div key={key} className="space-y-4 border-l-4 border-blue-200 pl-4 py-2">
                          <div className="flex justify-between items-center">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                              <Database className="w-5 h-5 text-blue-500" />
                              {label}
                            </h3>
                            <div className="flex items-center gap-2">
                              <Button 
                                variant="secondary" 
                                size="sm"
                                onClick={() => readHeaders(key)} 
                                disabled={loadingMap[key] || !config.sources[key].sheetUrl}
                              >
                                {loadingMap[key] ? "Đang đọc..." : "Đọc tiêu đề"}
                              </Button>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-500">Link Google Sheet</Label>
                            <Input 
                              placeholder="https://docs.google.com/spreadsheets/d/..." 
                              value={config.sources[key].sheetUrl}
                              onChange={(e) => {
                                const newSources = { ...config.sources };
                                newSources[key] = { ...newSources[key], sheetUrl: e.target.value };
                                setConfig({ ...config, sources: newSources });
                              }}
                            />
                          </div>

                          {(headersMap[key] || []).length > 0 && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                              <div className="space-y-2">
                                <Label className="text-xs flex items-center gap-2">
                                  <Phone className="w-3 h-3" />
                                  Số thuê bao
                                </Label>
                                <select 
                                  className="w-full h-9 px-3 py-1 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  value={config.sources[key].phoneColumn}
                                  onChange={(e) => {
                                    const newSources = { ...config.sources };
                                    newSources[key] = { ...newSources[key], phoneColumn: e.target.value };
                                    setConfig({ ...config, sources: newSources });
                                  }}
                                >
                                  <option value="">-- Chọn --</option>
                                  {(headersMap[key] || []).map((h, idx) => (
                                    <option key={`${key}-phone-${idx}`} value={h}>{h}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs flex items-center gap-2">
                                  <Table className="w-3 h-3" />
                                  Kết quả
                                </Label>
                                <select 
                                  className="w-full h-9 px-3 py-1 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  value={config.sources[key].statusColumn}
                                  onChange={(e) => {
                                    const newSources = { ...config.sources };
                                    newSources[key] = { ...newSources[key], statusColumn: e.target.value };
                                    setConfig({ ...config, sources: newSources });
                                  }}
                                >
                                  <option value="">-- Chọn --</option>
                                  {(headersMap[key] || []).map((h, idx) => (
                                    <option key={`${key}-status-${idx}`} value={h}>{h}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs flex items-center gap-2">
                                  <User className="w-3 h-3" />
                                  User cập nhật
                                </Label>
                                <select 
                                  className="w-full h-9 px-3 py-1 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  value={config.sources[key].updatedByUserColumn}
                                  onChange={(e) => {
                                    const newSources = { ...config.sources };
                                    newSources[key] = { ...newSources[key], updatedByUserColumn: e.target.value };
                                    setConfig({ ...config, sources: newSources });
                                  }}
                                >
                                  <option value="">-- Chọn --</option>
                                  {(headersMap[key] || []).map((h, idx) => (
                                    <option key={`${key}-user-${idx}`} value={h}>{h}</option>
                                  ))}
                                </select>
                              </div>
                            </motion.div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="pt-6 border-t border-slate-100 flex gap-4">
                      <Button onClick={handleImportAll} className="flex-1 bg-blue-600 hover:bg-blue-700 h-12 text-lg font-bold" disabled={isLoading}>
                        {isLoading ? (
                          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                        ) : (
                          <Database className="w-5 h-5 mr-2" />
                        )}
                        Import toàn bộ dữ liệu
                      </Button>
                      <Button onClick={handleSaveOnly} variant="outline" className="h-12 px-10 border-slate-200 text-slate-700" disabled={isLoading}>
                        Lưu cấu hình nguồn
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
