"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import moment from "moment";

const INITIAL_FORM = {
  book_id: "",
  book_title: "",
  en_book_name: "",
  th_book_name: "",
  publisher: "",
  price: "",
  creation_date: moment().format("YYYY-MM-DD"),
  is_special: "FALSE",
};

function BookShelfContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sheetId, setSheetId] = useState("");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // 🔍 Search State
  const [searchTerm, setSearchTerm] = useState("");

  // 📄 Pagination State (อ่านค่าหน้าปัจจุบันจาก URL Parameter เช่น ?page=2)
  const initialPage = parseInt(searchParams.get("page") || "1", 10);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const ITEMS_PER_PAGE = 10;

  // 📝 Modal Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState("ADD"); // 'ADD' หรือ 'EDIT'
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [targetRowIndex, setTargetRowIndex] = useState(null);

  // 🔄 ดึงข้อมูลจาก Sheet เมื่อมี Session
  useEffect(() => {
    if (session) {
      const savedSheetId = localStorage.getItem("saved_sheet_id");
      fetchBooks(savedSheetId || "");
    }
  }, [session]);

  // 🔄 Sync เลขหน้าเมื่อ URL หรือการกด ย้อนกลับ/ถัดไป ของเบราว์เซอร์เปลี่ยนไป
  useEffect(() => {
    const pageFromUrl = parseInt(searchParams.get("page") || "1", 10);
    setCurrentPage(pageFromUrl);
  }, [searchParams]);

  // 💡 ฟังก์ชันเปลี่ยนหน้า + อัปเดต URL Param
  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    router.push(`?${params.toString()}`, { scroll: false });
  };

  // 🔄 รีเซ็ตไปหน้า 1 เฉพาะเมื่อมีการพิมพ์ค้นหาจริง
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    if (currentPage !== 1) {
      handlePageChange(1);
    }
  };

  const fetchBooks = async (targetId) => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/sheet-data?sheetId=${targetId || ""}`);
      const result = await res.json();

      if (!res.ok)
        throw new Error(result.error || "เกิดข้อผิดพลาดในการดึงข้อมูล");

      setBooks(result.data || []);
      setSheetId(result.sheetId);
      localStorage.setItem("saved_sheet_id", result.sheetId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 🔢 คำนวณ Running Number สำหรับ book_id
  const generateNextBookId = () => {
    if (!books || books.length === 0) return "BK-0001";

    const numbers = books
      .map((b) => {
        const match = String(b.book_id || "").match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      })
      .filter((n) => !isNaN(n));

    const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
    const nextNumber = maxNumber + 1;

    return `BK-${String(nextNumber).padStart(4, "0")}`;
  };

  // 🔍 เช็กว่าค่าเป็น TRUE หรือไม่
  const checkIsSpecial = (val) => {
    if (val === true) return true;
    if (!val) return false;
    return String(val).trim().toUpperCase() === "TRUE";
  };

  // 📅 แปลงวันที่สำหรับ <input type="date">
  const formatDateForInput = (dateStr) => {
    if (!dateStr) return moment().format("YYYY-MM-DD");
    const m = moment(
      dateStr,
      ["YYYY-MM-DD", "DD/MM/YYYY", "DD-MMM-YYYY", moment.ISO_8601],
      true,
    );
    return m.isValid()
      ? m.format("YYYY-MM-DD")
      : moment(dateStr).format("YYYY-MM-DD");
  };

  // 📅 แปลงวันที่สำหรับแสดงผล
  const formatDateDisplay = (dateStr) => {
    if (!dateStr) return "-";
    const m = moment(dateStr, [
      "YYYY-MM-DD",
      "DD/MM/YYYY",
      "DD-MMM-YYYY",
      moment.ISO_8601,
    ]);
    return m.isValid() ? m.format("DD-MMM-YYYY") : dateStr;
  };

  // บันทึก / แก้ไข ข้อมูล
  const handleSaveBook = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch("/api/sheet-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetId,
          action: formMode,
          bookData: formData,
          rowIndex: targetRowIndex,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "บันทึกไม่สำเร็จ");

      setIsModalOpen(false);
      fetchBooks(sheetId);
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // เปิด Modal เพิ่มรายการใหม่
  const openAddModal = () => {
    setFormMode("ADD");
    const nextId = generateNextBookId();
    setFormData({
      ...INITIAL_FORM,
      book_id: nextId,
      creation_date: moment().format("YYYY-MM-DD"),
    });
    setIsModalOpen(true);
  };

  // เปิด Modal แก้ไขรายการ
  const openEditModal = (book) => {
    setFormMode("EDIT");
    setTargetRowIndex(book._rowIndex);
    setFormData({
      book_id: book.book_id || "",
      book_title: book.book_title || "",
      en_book_name: book.en_book_name || "",
      th_book_name: book.th_book_name || "",
      publisher: book.publisher || "",
      price: book.price || "",
      creation_date: formatDateForInput(book.creation_date),
      is_special: checkIsSpecial(book.is_special) ? "TRUE" : "FALSE",
    });
    setIsModalOpen(true);
  };

  // 📋 เปิด Modal คัดลอกรายการ
  const openDuplicateModal = (book) => {
    setFormMode("ADD");
    setTargetRowIndex(null);
    const nextId = generateNextBookId();
    setFormData({
      book_id: nextId,
      book_title: book.book_title || "",
      en_book_name: book.en_book_name || "",
      th_book_name: book.th_book_name || "",
      publisher: book.publisher || "",
      price: book.price || "",
      creation_date: moment().format("YYYY-MM-DD"),
      is_special: checkIsSpecial(book.is_special) ? "TRUE" : "FALSE",
    });
    setIsModalOpen(true);
  };

  // 🔍 ค้นหาข้อมูล
  const filteredBooks = useMemo(() => {
    if (!searchTerm.trim()) return books;

    const term = searchTerm.toLowerCase().trim();

    return books.filter((book) => {
      const title = String(
        book.book_title || book["Book Title"] || book.title || "",
      ).toLowerCase();
      const thName = String(
        book.th_book_name || book["TH Book Name"] || book.th_name || "",
      ).toLowerCase();
      const enName = String(
        book.en_book_name || book["EN Book Name"] || book.en_name || "",
      ).toLowerCase();
      const publisher = String(
        book.publisher || book["Publisher"] || "",
      ).toLowerCase();

      return (
        title.includes(term) ||
        thName.includes(term) ||
        enName.includes(term) ||
        publisher.includes(term) ||
        Object.values(book).some((val) =>
          String(val).toLowerCase().includes(term),
        )
      );
    });
  }, [books, searchTerm]);

  // คำนวณ Pagination
  const totalPages = Math.ceil(filteredBooks.length / ITEMS_PER_PAGE) || 1;
  const paginatedBooks = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredBooks.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredBooks, currentPage]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300 font-medium">
          <svg
            className="animate-spin h-6 w-6 text-indigo-500"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          กำลังโหลด...
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-slate-800 border border-slate-700/60 rounded-3xl p-2 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto text-3xl border border-indigo-500/20 shadow-inner">
            📚
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Book Shelf
            </h1>
            <p className="text-xs text-slate-400">
              ระบบจัดการคลังหนังสือส่วนตัวด้วย Google Sheets
            </p>
          </div>
          <button
            onClick={() => signIn("google")}
            className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/30 transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12.24 10.285V13.4h6.887C18.2 15.68 16.03 18 12.24 18c-3.48 0-6.3-2.82-6.3-6.3s2.82-6.3 6.3-6.3c1.55 0 2.96.57 4.04 1.51l2.42-2.42C17.26 3.12 14.93 2.25 12.24 2.25 6.84 2.25 2.5 6.59 2.5 12s4.34 9.75 9.74 9.75c5.63 0 9.38-3.96 9.38-9.54 0-.64-.07-1.12-.16-1.925H12.24z" />
            </svg>
            เข้าสู่ระบบด้วย Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col md:flex-row font-sans">
      {/* 📱 HEADER BAR (มือถือ) */}
      <header className="md:hidden sticky top-0 z-30 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">📚</span>
          <span className="font-bold text-lg text-white">Book Shelf</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAddModal}
            className="p-2 bg-indigo-600 text-white rounded-lg font-medium text-xs flex items-center gap-1 active:scale-95 transition"
          >
            + เพิ่มหนังสือ
          </button>
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 bg-slate-800 text-slate-300 rounded-lg border border-slate-700/60 active:scale-95 transition"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* 🖥️ DESKTOP MAIN WRAPPER */}
      <div className="hidden md:flex flex-1 flex-col min-w-0">
        <header className="bg-slate-900/60 backdrop-blur-md border-b border-slate-800/80 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h1 className="text-xl font-bold text-white">คลังหนังสือของคุณ</h1>
            <p className="text-xs text-slate-400">
              จัดการข้อมูลหนังสือ ปรับแก้ไขผ่านหน้าเว็บได้ทันที
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchBooks(sheetId)}
              disabled={loading}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700/60 active:scale-95 transition"
              title="รีเฟรชข้อมูล"
            >
              <svg
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            <button
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/20 active:scale-95 transition"
            >
              + เพิ่มหนังสือใหม่
            </button>
          </div>
        </header>

        <main className="p-2 flex-1 overflow-y-auto">
          {renderMainContent()}
        </main>
      </div>

      {/* 📱 MOBILE MAIN CONTENT */}
      <main className="p-4 flex-1 md:hidden">{renderMainContent()}</main>

      {/* 📂 SIDEBAR */}
      <div
        className={`fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm transition-opacity md:hidden ${
          isSidebarOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setIsSidebarOpen(false)}
      />

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-80 bg-slate-800 border-r border-slate-700/80 p-6 flex flex-col justify-between transition-transform duration-300 ease-in-out md:static md:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📚</span>
              <span className="font-bold text-lg text-white tracking-wide">
                Book Shelf
              </span>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="bg-slate-900/70 border border-slate-700/50 rounded-2xl p-4 flex items-center gap-3 shadow-inner">
            {session.user?.image ? (
              <img
                src={session.user.image}
                alt="profile"
                className="w-11 h-11 rounded-full border border-indigo-500/30"
              />
            ) : (
              <div className="w-11 h-11 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-white">
                {session.user?.name?.[0] || "U"}
              </div>
            )}
            <div className="overflow-hidden flex-1">
              <p className="font-semibold text-sm text-white truncate">
                {session.user?.name}
              </p>
              <p className="text-xs text-slate-400 truncate">
                {session.user?.email}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Google Sheet ID
            </label>
            <input
              type="text"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="วาง Sheet ID ของคุณ..."
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
            />
            <button
              onClick={() => {
                fetchBooks(sheetId);
                setIsSidebarOpen(false);
              }}
              disabled={loading}
              className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-xl border border-slate-600/50 active:scale-95 transition"
            >
              สลับ Sheet / โหลดใหม่
            </button>
            {error && <p className="text-rose-400 text-xs mt-1">{error}</p>}
          </div>
        </div>

        <div className="pt-6 border-t border-slate-700/60">
          <button
            onClick={() => signOut()}
            className="w-full py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* 📝 MODAL (สำหรับ เพิ่ม / แก้ไข / คัดลอก ข้อมูล) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-3">
              {formMode === "ADD"
                ? "✨ เพิ่ม/คัดลอกหนังสือใหม่"
                : "✏️ แก้ไขข้อมูลหนังสือ"}
            </h2>

            <form onSubmit={handleSaveBook} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 mb-1 flex items-center justify-between">
                    <span>Book ID</span>
                    <span className="text-[10px] text-indigo-400">
                      (Auto Running)
                    </span>
                  </label>
                  <input
                    type="text"
                    disabled
                    value={formData.book_id}
                    className="w-full p-2.5 bg-slate-950/70 border border-slate-700/80 rounded-xl text-indigo-300 font-mono font-bold cursor-not-allowed opacity-90"
                    title="book_id เป็นระบบ Running ไม่สามารถแก้ไขได้"
                  />
                </div>
                <div>
                  <label className="text-slate-400 mb-1 block">
                    ราคา (บาท)
                  </label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) =>
                      setFormData({ ...formData, price: e.target.value })
                    }
                    className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">
                  Book Title (ชื่อเรื่องหลัก)
                </label>
                <input
                  type="text"
                  required
                  value={formData.book_title}
                  onChange={(e) =>
                    setFormData({ ...formData, book_title: e.target.value })
                  }
                  className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 mb-1 block">
                    TH Book Name (ชื่อไทย)
                  </label>
                  <input
                    type="text"
                    value={formData.th_book_name}
                    onChange={(e) =>
                      setFormData({ ...formData, th_book_name: e.target.value })
                    }
                    className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 mb-1 block">
                    EN Book Name (ชื่ออังกฤษ)
                  </label>
                  <input
                    type="text"
                    value={formData.en_book_name}
                    onChange={(e) =>
                      setFormData({ ...formData, en_book_name: e.target.value })
                    }
                    className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 mb-1 block">
                    สำนักพิมพ์ (Publisher)
                  </label>
                  <input
                    type="text"
                    value={formData.publisher}
                    onChange={(e) =>
                      setFormData({ ...formData, publisher: e.target.value })
                    }
                    className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 mb-1 block">
                    วันที่สร้าง (Creation Date)
                  </label>
                  <input
                    type="date"
                    value={formData.creation_date}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        creation_date: e.target.value,
                      })
                    }
                    className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">
                  Is Special (ฉบับพิเศษ)
                </label>
                <select
                  value={formData.is_special}
                  onChange={(e) =>
                    setFormData({ ...formData, is_special: e.target.value })
                  }
                  className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="FALSE">ทั่วไป (FALSE)</option>
                  <option value="TRUE">พิเศษ (TRUE)</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-medium transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold shadow-lg shadow-indigo-600/30 disabled:opacity-50 transition"
                >
                  {saving ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );

  function renderMainContent() {
    return (
      <div className="space-y-5 max-w-6xl mx-auto">
        {/* 🔍 SEARCH BAR */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="ค้นหา book_title, สำนักพิมพ์..."
            className="w-full pl-10 pr-10 py-3 bg-slate-800/80 border border-slate-700/80 rounded-2xl text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition shadow-inner"
          />
          {searchTerm && (
            <button
              onClick={() => {
                setSearchTerm("");
                handlePageChange(1);
              }}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* 📦 TABLE / CARDS CONTENT */}
        {renderDataSection()}

        {/* 📄 PAGINATION CONTROLS */}
        {filteredBooks.length > 0 && (
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 shadow-md">
            <div className="text-center sm:text-left">
              แสดง{" "}
              <span className="font-semibold text-slate-200">
                {paginatedBooks.length}
              </span>{" "}
              จากทั้งหมด{" "}
              <span className="font-semibold text-slate-200">
                {filteredBooks.length}
              </span>{" "}
              เล่ม
            </div>

            <div className="flex items-center justify-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => handlePageChange(Math.max(currentPage - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600/50 disabled:opacity-40 disabled:hover:bg-slate-700 transition"
              >
                ย้อนกลับ
              </button>

              <span className="px-2 font-medium text-slate-300 whitespace-nowrap">
                {currentPage} / {totalPages}
              </span>

              <button
                onClick={() =>
                  handlePageChange(Math.min(currentPage + 1, totalPages))
                }
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600/50 disabled:opacity-40 disabled:hover:bg-slate-700 transition"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderDataSection() {
    if (loading && books.length === 0) {
      return (
        <div className="p-12 text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="text-sm text-slate-400">
            กำลังเชื่อมต่อและโหลดข้อมูล Google Sheet...
          </p>
        </div>
      );
    }

    if (books.length === 0) {
      return (
        <div className="p-12 text-center bg-slate-800/40 border border-slate-800 rounded-3xl space-y-3">
          <span className="text-4xl">📭</span>
          <p className="text-slate-300 font-medium">
            ยังไม่มีข้อมูลหนังสือใน Sheet
          </p>
          <button
            onClick={openAddModal}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition"
          >
            + เพิ่มหนังสือเล่มแรก
          </button>
        </div>
      );
    }

    if (filteredBooks.length === 0) {
      return (
        <div className="p-12 text-center bg-slate-800/40 border border-slate-800 rounded-3xl space-y-2">
          <span className="text-3xl">🔍</span>
          <p className="text-slate-300 font-medium">
            ไม่พบข้อมูลที่ตรงกับ "{searchTerm}"
          </p>
          <button
            onClick={() => {
              setSearchTerm("");
              handlePageChange(1);
            }}
            className="text-xs text-indigo-400 hover:underline pt-1"
          >
            ล้างคำค้นหา
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* 📱 MOBILE VIEW: Cards */}
        <div className="grid gap-3 sm:hidden">
          {paginatedBooks.map((book, idx) => {
            const globalIndex = (currentPage - 1) * ITEMS_PER_PAGE + idx + 1;
            const isSpecial = checkIsSpecial(book.is_special);

            return (
              <div
                key={idx}
                className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-4 space-y-3 shadow-sm"
              >
                {/* Header การ์ด: ลำดับที่ + Tag Special (ถ้ามี) + ปุ่มคัดลอก/แก้ไข */}
                <div className="flex items-center justify-between border-b border-slate-700/50 pb-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                      #{globalIndex}
                    </span>

                    {/* ✨ Tag Special บนมือถือ */}
                    {isSpecial && (
                      <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md text-[10px] font-bold tracking-wider">
                        SPECIAL
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openDuplicateModal(book)}
                      className="text-[11px] text-slate-300 hover:text-white font-medium px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg border border-slate-600 active:scale-95 transition"
                    >
                      คัดลอก
                    </button>
                    <button
                      onClick={() => openEditModal(book)}
                      className="text-[11px] text-indigo-300 hover:text-white font-medium px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600 rounded-lg border border-indigo-500/30 active:scale-95 transition"
                    >
                      แก้ไข
                    </button>
                  </div>
                </div>

                {/* รายละเอียดชื่อหนังสือ */}
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[11px] font-medium text-slate-400 truncate">
                    {book.book_title || "-"}
                  </p>
                  <p className="font-bold text-sm text-white truncate">
                    {book.th_book_name || "-"}
                  </p>
                </div>

                {/* ข้อมูลอื่นๆ */}
                <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-slate-700/30">
                  <div className="col-span-1">
                    <span className="text-slate-400 text-[10px] block">
                      ราคา:
                    </span>
                    <span className="text-indigo-300 font-semibold block">
                      {book.price ? `${book.price} ฿` : "-"}
                    </span>
                  </div>
                  <div className="col-span-1">
                    <span className="text-slate-400 text-[10px] block">
                      สำนักพิมพ์:
                    </span>
                    <span
                      className="text-slate-200 truncate block"
                      title={book.publisher}
                    >
                      {book.publisher || "-"}
                    </span>
                  </div>
                  <div className="col-span-1 text-right">
                    <span className="text-slate-400 text-[10px] block">
                      วันที่เพิ่ม:
                    </span>
                    <span className="text-slate-300 font-mono text-[11px] block">
                      {formatDateDisplay(book.creation_date)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 💻 DESKTOP VIEW: Table */}
        <div className="hidden sm:block bg-slate-800/60 border border-slate-700/60 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed">
              <thead>
                <tr className="bg-slate-800 border-b border-slate-700 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <th className="p-4 w-12 text-center">#</th>
                  <th className="p-4">Title / TH Name</th>
                  <th className="p-4">Publisher</th>
                  <th className="p-4 w-24 text-right">Price</th>
                  <th className="p-4 w-28 text-center">Date</th>
                  <th className="p-4 w-24 text-center">Special</th>
                  <th className="p-4 w-36 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50 text-xs text-slate-300">
                {paginatedBooks.map((book, idx) => {
                  const globalIndex =
                    (currentPage - 1) * ITEMS_PER_PAGE + idx + 1;
                  return (
                    <tr
                      key={idx}
                      className="hover:bg-slate-700/30 transition-colors"
                    >
                      <td className="p-4 text-center font-mono text-slate-500">
                        {globalIndex}
                      </td>
                      <td
                        className="p-4"
                        title={`${book.book_title || ""} - ${book.th_book_name || ""}`}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="text-[10px] font-medium text-slate-400 truncate">
                            {book.book_title || "-"}
                          </span>
                          <span className="font-semibold text-white truncate">
                            {book.th_book_name || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 truncate" title={book.publisher}>
                        {book.publisher || "-"}
                      </td>
                      <td className="p-4 text-right font-semibold text-indigo-300">
                        {book.price
                          ? `${Number(book.price).toLocaleString()} ฿`
                          : "-"}
                      </td>
                      <td className="p-4 text-center font-mono text-slate-400">
                        {formatDateDisplay(book.creation_date)}
                      </td>
                      <td className="p-4 text-center">
                        {checkIsSpecial(book.is_special) ? (
                          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md text-[10px] font-bold">
                            SPECIAL
                          </span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openDuplicateModal(book)}
                            className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition border border-slate-600 text-[11px] font-medium"
                            title="คัดลอกและสร้างรายการใหม่จากข้อมูลนี้"
                          >
                            คัดลอก
                          </button>
                          <button
                            onClick={() => openEditModal(book)}
                            className="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded-lg transition border border-indigo-500/30 text-[11px] font-medium"
                          >
                            แก้ไข
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
}

// 🛡️ ห่อด้วย Suspense เพื่อป้องกันปัญหา Next.js App Router Hydration บั๊กเรื่อง searchParams
export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-300">
          กำลังโหลด...
        </div>
      }
    >
      <BookShelfContent />
    </Suspense>
  );
}
