"use client";

/**
 * SHELFWISE: how this page works
 * -------------------------------------------------------------------------
 * 1. Login: NextAuth signs the user in with Google. The login asks for Drive
 *    (metadata only) and Sheets permission; see lib/auth.js.
 * 2. Load: once a session exists, fetchBooks() calls GET /api/sheet-data.
 *    - No sheetId  -> the server searches the user's Google Drive for a
 *      spreadsheet named "BookTracker_Data" and reads its "Books" tab.
 *    - With sheetId -> the server reads that spreadsheet instead (manual
 *      override from the settings drawer, remembered in localStorage).
 * 3. Show: rows come back as objects (book_title, price...). Search and
 *    pagination run in the browser; the page number lives in the URL (?page=2).
 * 4. Save: add / edit / duplicate all send POST /api/sheet-data with
 *    { sheetId, action: "ADD" | "EDIT", bookData, rowIndex }, then reload.
 * 5. Auth errors (401) show a banner with a "sign in again" button.
 * -------------------------------------------------------------------------
 */

import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
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

const ITEMS_PER_PAGE = 12;
const TEXT = {
  en: {
    loading: "Loading…",
    library: "Your library",
    connecting: "Connecting to Google Sheets",
    books: "Books",
    specialEditions: "Special editions",
    totalValue: "Total value",
    search: "Search by title, publisher or ID",
    clearSearch: "Clear search",
    signInAgain: "Sign in again",
    tryAgain: "Try again",
    noBooks: "No books in this sheet yet",
    firstBookHint: "Add your first book to get started.",
    addFirstBook: "Add your first book",
    noResults: "No results for",
    searchHint: "Try a different word or check the spelling.",
    clear: "Clear search",
    special: "Special",
    noPublisher: "No publisher",
    edit: "Edit",
    duplicate: "Duplicate",
    duplicateTitle: "Create a new entry from this book",
    showing: "Showing",
    of: "of",
    previous: "Previous",
    next: "Next",
    account: "Account & sheet",
    addBook: "Add book",
    settings: "Preferences & account",
    close: "Close",
    refresh: "Refresh",
    bookCount: "books",
    language: "Language",
    theme: "Appearance",
    light: "Light mode",
    dark: "Dark mode",
    thai: "ไทย",
    english: "English",
    googleSheet: "Google Sheet",
    sheetHelp: 'We look for a file named "BookTracker_Data" (tab: Books) in your Google Drive automatically. Use this field only to switch to a different file.',
    sheetPlaceholder: "Paste a Google Sheets URL or ID",
    useSheet: "Use this sheet",
    autoSheet: "Use automatic BookTracker_Data",
    signOut: "Sign out",
    addTitle: "Add a book",
    editTitle: "Edit book",
    bookId: "Book ID",
    auto: "Auto",
    price: "Price (THB)",
    mainTitle: "Main title",
    thaiTitle: "Thai title",
    englishTitle: "English title",
    publisher: "Publisher",
    dateAdded: "Date added",
    specialEdition: "Special edition",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    appTagline: "Your personal library, beautifully in sync.",
    signIn: "Continue with Google",
  },
  th: {
    loading: "กำลังโหลด…",
    library: "ห้องสมุดของคุณ",
    connecting: "กำลังเชื่อมต่อ Google Sheets",
    books: "หนังสือทั้งหมด",
    specialEditions: "ฉบับพิเศษ",
    totalValue: "มูลค่ารวม",
    search: "ค้นหาจากชื่อหนังสือ สำนักพิมพ์ หรือรหัส",
    clearSearch: "ล้างคำค้นหา",
    signInAgain: "เข้าสู่ระบบอีกครั้ง",
    tryAgain: "ลองอีกครั้ง",
    noBooks: "ยังไม่มีหนังสือในชีตนี้",
    firstBookHint: "เพิ่มหนังสือเล่มแรกเพื่อเริ่มต้น",
    addFirstBook: "เพิ่มหนังสือเล่มแรก",
    noResults: "ไม่พบผลลัพธ์สำหรับ",
    searchHint: "ลองใช้คำอื่นหรือตรวจสอบการสะกด",
    clear: "ล้างคำค้นหา",
    special: "ฉบับพิเศษ",
    noPublisher: "ไม่ระบุสำนักพิมพ์",
    edit: "แก้ไข",
    duplicate: "ทำสำเนา",
    duplicateTitle: "สร้างรายการใหม่จากหนังสือเล่มนี้",
    showing: "แสดง",
    of: "จากทั้งหมด",
    previous: "ก่อนหน้า",
    next: "ถัดไป",
    account: "บัญชีและชีต",
    addBook: "เพิ่มหนังสือ",
    settings: "การตั้งค่าและบัญชี",
    close: "ปิด",
    refresh: "รีเฟรช",
    bookCount: "เล่ม",
    language: "ภาษา",
    theme: "ธีม",
    light: "โหมดสว่าง",
    dark: "โหมดมืด",
    thai: "ไทย",
    english: "English",
    googleSheet: "Google Sheet",
    sheetHelp: 'ระบบค้นหาไฟล์ "BookTracker_Data" (แท็บ Books) ใน Google Drive ให้อัตโนมัติ ใช้ช่องนี้เมื่อต้องการเปลี่ยนไฟล์เท่านั้น',
    sheetPlaceholder: "วาง URL หรือ ID ของ Google Sheets",
    useSheet: "ใช้ชีตนี้",
    autoSheet: "กลับไปใช้ BookTracker_Data อัตโนมัติ",
    signOut: "ออกจากระบบ",
    addTitle: "เพิ่มหนังสือ",
    editTitle: "แก้ไขหนังสือ",
    bookId: "รหัสหนังสือ",
    auto: "อัตโนมัติ",
    price: "ราคา (บาท)",
    mainTitle: "ชื่อหลัก",
    thaiTitle: "ชื่อภาษาไทย",
    englishTitle: "ชื่อภาษาอังกฤษ",
    publisher: "สำนักพิมพ์",
    dateAdded: "วันที่เพิ่ม",
    specialEdition: "ฉบับพิเศษ",
    cancel: "ยกเลิก",
    save: "บันทึก",
    saving: "กำลังบันทึก…",
    appTagline: "ห้องสมุดส่วนตัวของคุณ ที่จัดการได้อย่างลงตัว",
    signIn: "ดำเนินการต่อด้วย Google",
  },
};
// Read ?page= from the URL; fall back to 1 for missing / invalid / negative values.
const readPage = (sp) => Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
const SPINES = [
  "#2dd4bf",
  "#f59e0b",
  "#60a5fa",
  "#fb7185",
  "#a78bfa",
  "#a3e635",
  "#f472b6",
  "#22d3ee",
];
const spineColor = (s) => {
  let h = 0;
  for (const c of String(s || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPINES[h % SPINES.length];
};

const ICONS = {
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  close: "M6 18L18 6M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  refresh:
    "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  check: "M5 13l4 4L19 7",
  logout:
    "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  sheet:
    "M3 10h18M3 14h18M9 4v16M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  copy: "M8 7h8a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2V9a2 2 0 012-2zM4 15V5a2 2 0 012-2h10",
  edit: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.4-9.6a2 2 0 112.8 2.8L11.8 15H9v-2.8l8.6-8.8z",
  star: "M11.05 2.93a1 1 0 011.9 0l1.5 3.4 3.7.4a1 1 0 01.56 1.74l-2.76 2.5.8 3.65a1 1 0 01-1.49 1.08L12 13.8l-3.26 1.9a1 1 0 01-1.49-1.08l.8-3.65-2.76-2.5a1 1 0 01.56-1.74l3.7-.4 1.5-3.4z",
};
const Icon = ({ name, className = "w-4 h-4", spin }) => (
  <svg
    className={`${className} ${spin ? "animate-spin" : ""}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
  >
    <path d={ICONS[name]} />
  </svg>
);



const field =
  "w-full px-3.5 py-2.5 bg-slate-950/60 border border-white/10 rounded-xl text-base sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-400/70 focus:ring-4 focus:ring-teal-400/10 transition";

// Counts a number up to `value`; skipped when the user prefers reduced motion.
function useCountUp(value, ms = 900) {
  const [n, setN] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    if (
      from === value ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      prev.current = value;
      setN(value);
      return;
    }
    let raf, t0;
    const tick = (t) => {
      t0 = t0 ?? t;
      const p = Math.min((t - t0) / ms, 1);
      setN(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3)))); // ease-out
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return n;
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs font-medium text-slate-400 mb-1.5">
        {label}
        {hint && <span className="text-teal-400 font-normal">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Preferences({ language, onLanguageChange, theme, onToggleTheme, t }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onLanguageChange(language === "en" ? "th" : "en")}
        aria-pressed={language === "th"}
        aria-label={`${t("language")}: ${language === "en" ? t("thai") : t("english")}`}
        className="bs-preference-control"
      >
        {language === "en" ? "ไทย" : "EN"}
      </button>
      <button
        type="button"
        onClick={onToggleTheme}
        aria-pressed={theme === "light"}
        aria-label={theme === "dark" ? t("light") : t("dark")}
        className="bs-preference-control"
      >
        <span aria-hidden>{theme === "dark" ? "☼" : "☾"}</span>
        <span className="hidden sm:inline">{theme === "dark" ? t("light") : t("dark")}</span>
      </button>
    </div>
  );
}

function BookShelfContent() {
  // ---- Auth & routing ----
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [language, setLanguage] = useState("en");
  const [theme, setTheme] = useState("dark");
  const t = (key) => TEXT[language][key];

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setLanguage(
        localStorage.getItem("shelfwise_language") === "th" ? "th" : "en",
      );
      setTheme(
        localStorage.getItem("shelfwise_theme") === "light" ? "light" : "dark",
      );
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const changeLanguage = (nextLanguage) => {
    setLanguage(nextLanguage);
    localStorage.setItem("shelfwise_language", nextLanguage);
  };

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("shelfwise_theme", nextTheme);
  };

  // ---- Data ----
  // sheetId: the spreadsheet currently in use (found by the server or typed by the user).
  // manualId: the optional override typed in the settings drawer.
  const [sheetId, setSheetId] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [manualId, setManualId] = useState("");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(false); // true when the server answered 401
  const [formError, setFormError] = useState(""); // error shown inside the add/edit form
  // ---- UI state ----
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Pagination: the current page is mirrored in the URL so Back / refresh keep your place.
  const currentPage = readPage(searchParams);

  // Add / edit form state (formMode decides which action is sent to the API).
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState("ADD");
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [targetRowIndex, setTargetRowIndex] = useState(null);

  // Change page and write it into the URL (?page=N) without scrolling to top.
  const handlePageChange = (newPage) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    router.push(`?${params.toString()}`, { scroll: false });
  };

  // Typing in search always jumps back to page 1.
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    if (currentPage !== 1) handlePageChange(1);
  };

  // Accept a full Google Sheets URL or a bare ID; extract the ID from ".../d/<ID>/...".
  const handleSheetInput = (input) => {
    if (!input) return "";
    const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match && match[1] ? match[1] : input.trim();
  };

  // Load books from the API. targetId "" => the server finds BookTracker_Data itself.
  const fetchBooks = useCallback(async (targetId = "", isRetry = false) => {
    const loadBooks = async (requestedId, retry) => {
      setLoading(true);
      setError("");
      setAuthError(false);
      try {
        const res = await fetch(
          `/api/sheet-data?sheetId=${encodeURIComponent(requestedId || "")}`,
        );
        const result = await res.json().catch(() => ({}));

        // 401 = not signed in / token expired / Google refused the token.
        if (res.status === 401) {
          setAuthError(true);
          throw new Error(
            result.error ||
              "Your session has expired. Please sign in again to reconnect Google.",
          );
        }
        // The remembered sheet is gone: forget it and fall back to auto-discovery (once).
        if (res.status === 404 && requestedId && !retry) {
          localStorage.removeItem("saved_sheet_id");
          setManualId("");
          return loadBooks("", true);
        }
        if (!res.ok) {
          throw new Error(result.error || "Could not load your books.");
        }

        setBooks(result.data || []);
        setSheetId(result.sheetId);
        setSheetName(result.sheetName || "");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    return loadBooks(targetId, isRetry);
  }, []);

  // Load the selected spreadsheet when the authenticated session becomes available.
  useEffect(() => {
    if (status !== "authenticated") return;

    const frame = requestAnimationFrame(() => {
      const saved = localStorage.getItem("saved_sheet_id") || "";
      setManualId(saved);
      fetchBooks(saved);
    });
    return () => cancelAnimationFrame(frame);
  }, [status, fetchBooks]);

  // Switch between a manually selected sheet and automatic Drive discovery.
  const handleConfirmSheetId = (id) => {
    if (!id) return;
    localStorage.setItem("saved_sheet_id", id);
    fetchBooks(id);
    setIsSettingsOpen(false);
  };

  const handleUseAuto = () => {
    localStorage.removeItem("saved_sheet_id");
    setManualId("");
    fetchBooks("");
    setIsSettingsOpen(false);
  };

  // Next ID = highest number found in book_id + 1, e.g. BK-0007 -> BK-0008.
  const generateNextBookId = () => {
    if (!books || books.length === 0) return "BK-0001";
    const numbers = books
      .map((b) => {
        const m = String(b.book_id || "").match(/\d+/);
        return m ? parseInt(m[0], 10) : 0;
      })
      .filter((n) => !isNaN(n));
    const max = numbers.length ? Math.max(...numbers) : 0;
    return `BK-${String(max + 1).padStart(4, "0")}`;
  };

  // Sheets may return true, "TRUE" or "true"; normalise to a boolean.
  const checkIsSpecial = (val) => {
    if (val === true) return true;
    if (!val) return false;
    return String(val).trim().toUpperCase() === "TRUE";
  };

  // Sheet date text -> "YYYY-MM-DD" (what <input type="date"> needs).
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

  const formatDateDisplay = (dateStr) => {
    if (!dateStr) return "-";
    const m = moment(dateStr, [
      "YYYY-MM-DD",
      "DD/MM/YYYY",
      "DD-MMM-YYYY",
      moment.ISO_8601,
    ]);
    return m.isValid() ? m.format("DD MMM YYYY") : dateStr;
  };

  // Save the form. ADD appends a row; EDIT updates the row at targetRowIndex.
  const handleSaveBook = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");
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
      if (!res.ok) throw new Error(result.error || "Could not save the book.");
      setIsModalOpen(false);
      fetchBooks(sheetId);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Copy a book into form fields (used by Edit and Duplicate).
  const bookToForm = (book) => ({
    book_title: book.book_title || "",
    en_book_name: book.en_book_name || "",
    th_book_name: book.th_book_name || "",
    publisher: book.publisher || "",
    price: book.price || "",
    is_special: checkIsSpecial(book.is_special) ? "TRUE" : "FALSE",
  });

  const openAddModal = () => {
    setFormMode("ADD");
    setTargetRowIndex(null);
    setFormData({
      ...INITIAL_FORM,
      book_id: generateNextBookId(),
      creation_date: moment().format("YYYY-MM-DD"),
    });
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = (book) => {
    setFormMode("EDIT");
    setTargetRowIndex(book._rowIndex);
    setFormData({
      ...bookToForm(book),
      book_id: book.book_id || "",
      creation_date: formatDateForInput(book.creation_date),
    });
    setFormError("");
    setIsModalOpen(true);
  };

  const openDuplicateModal = (book) => {
    setFormMode("ADD");
    setTargetRowIndex(null);
    setFormData({
      ...bookToForm(book),
      book_id: generateNextBookId(),
      creation_date: moment().format("YYYY-MM-DD"),
    });
    setFormError("");
    setIsModalOpen(true);
  };

  // Search runs in the browser: any column containing the text matches.
  const filteredBooks = useMemo(() => {
    if (!searchTerm.trim()) return books;
    const term = searchTerm.toLowerCase().trim();
    return books.filter((book) =>
      Object.values(book).some((val) =>
        String(val).toLowerCase().includes(term),
      ),
    );
  }, [books, searchTerm]);

  // Numbers for the summary row.
  const stats = useMemo(() => {
    const total = books.reduce((s, b) => s + (Number(b.price) || 0), 0);
    return {
      count: books.length,
      special: books.filter((b) => checkIsSpecial(b.is_special)).length,
      total,
    };
  }, [books]);

  // Animated versions of the summary numbers.
  const countBooks = useCountUp(stats.count);
  const countSpecial = useCountUp(stats.special);
  const countTotal = useCountUp(Math.round(stats.total));

  // Slice the filtered list into pages of ITEMS_PER_PAGE.
  const totalPages = Math.ceil(filteredBooks.length / ITEMS_PER_PAGE) || 1;
  const paginatedBooks = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredBooks.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredBooks, currentPage]);

  // If the list shrinks (search / refresh) and the page is out of range, go to the last page.
  useEffect(() => {
    if (!loading && books.length > 0 && currentPage > totalPages) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", totalPages.toString());
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [books.length, currentPage, loading, router, searchParams, totalPages]);

  // ---- Render: loading -> logged out -> main app ----
  if (status === "loading") {
    return (
      <div className="bs-root min-h-[100dvh] bg-[#0b0f14] flex items-center justify-center text-slate-400 gap-3">
        <Icon name="refresh" className="w-5 h-5 text-teal-400" spin />
        {t("loading")}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="bs-root min-h-[100dvh] bg-[#0b0f14] relative isolate flex items-center justify-center p-5" data-theme={theme}>
        <div className="bs-bg" aria-hidden />
        <div className="w-full max-w-md">
          <div className="flex justify-end mb-8">
            <Preferences language={language} onLanguageChange={changeLanguage} theme={theme} onToggleTheme={toggleTheme} t={t} />
          </div>
          <div className="mb-8 flex items-center gap-3" aria-hidden>
            <Image src="/morrow-mark.svg" alt="" width={56} height={56} className="h-14 w-14" />
            <span className="bs-display text-sm font-semibold uppercase tracking-[.22em] text-teal-300">
              Morrow
            </span>
          </div>
          <h1
            style={{ "--i": 6 }}
            className="bs-rise bs-display text-4xl font-semibold text-slate-100 leading-snug"
          >
            Morrow
          </h1>
          <p
            style={{ "--i": 7 }}
            className="bs-rise mt-3 text-slate-400 leading-relaxed"
          >
            {t("appTagline")}
          </p>
          <button
            onClick={() => signIn("google")}
            style={{ "--i": 8 }}
            className="bs-btn bs-rise mt-8 w-full py-3.5 bg-gradient-to-br from-teal-500 to-teal-600 text-white font-medium rounded-xl active:scale-[0.99]"
          >
            {t("signIn")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bs-root relative isolate min-h-[100dvh] bg-[#0b0f14] text-slate-100" data-theme={theme}>
      <div className="bs-bg" aria-hidden />

      {/* Top bar */}
      <header className="sticky top-0 z-30 pt-[env(safe-area-inset-top)] bg-[#0b0f14]/70 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[4.5rem] flex items-center gap-3">
          <div className="mr-auto flex items-center gap-2.5">
            <Image src="/morrow-mark.svg" alt="" width={36} height={36} className="h-9 w-9" />
            <span className="bs-display text-xl font-bold tracking-tight">Morrow</span>
          </div>
          <Preferences language={language} onLanguageChange={changeLanguage} theme={theme} onToggleTheme={toggleTheme} t={t} />
          <button
            onClick={() => fetchBooks(sheetId)}
            disabled={loading}
            title={t("refresh")}
            aria-label={t("refresh")}
            className="p-2.5 rounded-lg text-slate-400 hover:bg-slate-800 transition"
          >
            <Icon name="refresh" spin={loading} />
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition"
          >
            {session.user?.image ? (
              <img
                src={session.user.image}
                alt=""
                className="w-6 h-6 rounded-full"
              />
            ) : (
              <span className="w-6 h-6 rounded-full bg-teal-600 text-white text-xs flex items-center justify-center">
                {session.user?.name?.[0] || "U"}
              </span>
            )}
            <span className="hidden sm:inline">{t("account")}</span>
          </button>
          <button
            onClick={openAddModal}
            className="bs-btn hidden sm:flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-br from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white text-sm font-medium rounded-xl active:scale-95"
          >
            <Icon name="plus" /> {t("addBook")}
          </button>
        </div>
      </header>

      {/* Mobile: floating add button, kept clear of the home indicator */}
      <button
        onClick={openAddModal}
        aria-label="Add book"
        className="bs-fab sm:hidden fixed right-4 z-30 w-14 h-14 rounded-full bg-teal-400 text-slate-950 shadow-xl shadow-black/50 flex items-center justify-center active:scale-95 transition"
        style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <Icon name="plus" className="w-6 h-6" />
      </button>

      <main className="bs-library max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-28 sm:py-10 space-y-7">
        {/* Summary */}
        <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div>
            <h1
              className={`bs-rise bs-display ${theme === "light" ? "bs-title-light" : "bs-gradient-text"} text-3xl sm:text-4xl font-semibold leading-snug`}
            >
              {t("library")}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {sheetName
                ? `${sheetName} › Books`
                : t("connecting")}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 w-full sm:w-auto sm:flex sm:gap-4 text-sm">
            {[
              [t("books"), countBooks, ""],
              [t("specialEditions"), countSpecial, ""],
              [t("totalValue"), countTotal.toLocaleString(), "฿"],
            ].map(([label, val, unit], i) => (
              <div
                key={label}
                style={{ "--i": i + 1 }}
                className="bs-rise bs-glass border border-white/5 rounded-2xl px-4 py-3 sm:min-w-[7.5rem]"
              >
                <dt className="text-xs text-slate-400">{label}</dt>
                <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
                  {val}
                  {unit && (
                    <span className="text-sm font-normal text-slate-400">
                      {" "}
                      {unit}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Search */}
        <div className="relative">
          <span className="absolute inset-y-0 left-4 flex items-center text-slate-500 pointer-events-none">
            <Icon name="search" />
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder={t("search")}
            className={`${field} pl-11 pr-11 py-3.5 rounded-2xl backdrop-blur`}
          />
          {searchTerm && (
            <button
              onClick={() => {
                setSearchTerm("");
                handlePageChange(1);
              }}
              aria-label={t("clearSearch")}
              className="absolute inset-y-0 right-3 px-1 text-slate-500 hover:text-slate-200"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-4 p-4 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm rounded-xl"
          >
            <span>{error}</span>
            {authError ? (
              <button
                onClick={() => signIn("google")}
                className="font-medium underline whitespace-nowrap"
              >
                {t("signInAgain")}
              </button>
            ) : (
              <button
                onClick={() => fetchBooks(sheetId)}
                className="font-medium underline"
              >
                {t("tryAgain")}
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {loading && books.length === 0 ? (
          <div
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy="true"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bs-skel h-40 rounded-2xl" />
            ))}
          </div>
        ) : books.length === 0 ? (
          <div className="py-20 text-center">
            <p className="bs-display text-xl font-bold">
              {t("noBooks")}
            </p>
            <p className="text-sm text-slate-400 mt-1">
              {t("firstBookHint")}
            </p>
            <button
              onClick={openAddModal}
              className="mt-5 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition"
            >
              {t("addFirstBook")}
            </button>
          </div>
        ) : filteredBooks.length === 0 ? (
          <div className="py-20 text-center">
            <p className="bs-display text-xl font-bold">
              {t("noResults")} &quot;{searchTerm}&quot;
            </p>
            <p className="text-sm text-slate-400 mt-1">
              {t("searchHint")}
            </p>
            <button
              onClick={() => {
                setSearchTerm("");
                handlePageChange(1);
              }}
              className="mt-4 text-sm font-medium text-teal-400 hover:underline"
            >
              {t("clear")}
            </button>
          </div>
        ) : (
          <ul
            key={currentPage}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {paginatedBooks.map((book, idx) => {
              const special = checkIsSpecial(book.is_special);
              const color = spineColor(book.book_title || book.th_book_name);
              const n = (currentPage - 1) * ITEMS_PER_PAGE + idx + 1;
              return (
                <li
                  key={book.book_id || idx}
                  style={{ "--i": idx, "--spine": color }}
                  className={`bs-rise bs-card group flex overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-[#161d29] to-[#10151d] hover:border-white/15 ${special ? "bs-special" : ""}`}
                >
                  <div
                    className="bs-spine w-2.5 shrink-0"
                    style={{
                      background: `linear-gradient(180deg, ${color}, ${color}55)`,
                    }}
                    aria-hidden
                  />
                  <span
                    className="pointer-events-none absolute -right-1 -top-5 select-none bs-display text-8xl font-bold opacity-[0.05] group-hover:opacity-[0.1] transition-opacity duration-500"
                    style={{ color }}
                    aria-hidden
                  >
                    {String(book.th_book_name || book.book_title || "?")
                      .trim()
                      .charAt(0)}
                  </span>
                  <div className="flex-1 min-w-0 p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-slate-500 tabular-nums">
                        #{n}{" "}
                        {book.book_id && (
                          <span className="ml-1">{book.book_id}</span>
                        )}
                      </span>
                      {special && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 bg-amber-500/15 rounded-full px-2 py-0.5">
                          <Icon name="star" className="w-3 h-3" /> {t("special")}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3
                        className="bs-display font-semibold leading-snug text-slate-100 line-clamp-2"
                        title={book.th_book_name || book.book_title}
                      >
                        {book.th_book_name || book.book_title || "-"}
                      </h3>
                      {book.th_book_name && book.book_title && (
                        <p
                          className="text-sm text-slate-400 truncate mt-0.5"
                          title={book.book_title}
                        >
                          {book.book_title}
                        </p>
                      )}
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-3 pt-1">
                      <div className="min-w-0 text-xs text-slate-400">
                        <p className="truncate" title={book.publisher}>
                          {book.publisher || t("noPublisher")}
                        </p>
                        <p className="mt-0.5">
                          {formatDateDisplay(book.creation_date)}
                        </p>
                      </div>
                      <p className="text-lg font-semibold tabular-nums whitespace-nowrap text-teal-300">
                        {book.price
                          ? `${Number(book.price).toLocaleString()} ฿`
                          : "-"}
                      </p>
                    </div>
                    <div className="flex gap-2 pt-3 border-t border-slate-800">
                      <button
                        onClick={() => openEditModal(book)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 hover:text-white active:scale-95 rounded-lg transition"
                      >
                        <Icon name="edit" className="w-3.5 h-3.5" /> {t("edit")}
                      </button>
                      <button
                        onClick={() => openDuplicateModal(book)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 hover:text-white active:scale-95 rounded-lg transition"
                        title={t("duplicateTitle")}
                      >
                        <Icon name="copy" className="w-3.5 h-3.5" /> {t("duplicate")}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Pagination */}
        {filteredBooks.length > 0 && (
          <nav
            className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-400"
            aria-label="Pagination"
          >
            <p>
              {t("showing")} {paginatedBooks.length} {t("of")} {filteredBooks.length} {t("bookCount")}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handlePageChange(Math.max(currentPage - 1, 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-slate-200 hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                {t("previous")}
              </button>
              <span className="tabular-nums text-slate-300">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() =>
                  handlePageChange(Math.min(currentPage + 1, totalPages))
                }
                disabled={currentPage === totalPages}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-slate-200 hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                {t("next")}
              </button>
            </div>
          </nav>
        )}
      </main>

      {/* Settings drawer */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="bs-fade absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsSettingsOpen(false)}
          />
          <aside className="relative w-full max-w-sm bg-[#121821] border-l border-white/5 h-full p-6 flex flex-col shadow-2xl bs-drawer">
            <div className="flex items-center justify-between mb-6">
              <h2 className="bs-display text-lg font-bold">{t("settings")}</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                aria-label={t("close")}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-white/10 p-4 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t("language")} · {t("theme")}</p>
              <Preferences language={language} onLanguageChange={changeLanguage} theme={theme} onToggleTheme={toggleTheme} t={t} />
            </div>

            <div className="mt-4 flex items-center gap-3 p-3 bg-slate-900/60 rounded-xl border border-slate-800">
              {session.user?.image ? (
                <img
                  src={session.user.image}
                  alt=""
                  className="w-10 h-10 rounded-full"
                />
              ) : (
                <span className="w-10 h-10 rounded-full bg-teal-600 text-white flex items-center justify-center font-semibold">
                  {session.user?.name?.[0] || "U"}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {session.user?.name}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {session.user?.email}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <label
                htmlFor="sheet-id"
                className="flex items-center gap-1.5 text-sm font-medium text-slate-300"
              >
                <Icon name="sheet" className="w-4 h-4 text-teal-400" /> {t("googleSheet")}
              </label>
              <p className="text-xs text-slate-400">
                {t("sheetHelp")}
              </p>
              <div className="relative">
                <input
                  id="sheet-id"
                  type="text"
                  value={manualId}
                  onChange={(e) =>
                    setManualId(handleSheetInput(e.target.value))
                  }
                  placeholder={t("sheetPlaceholder")}
                  className={`${field} pr-10`}
                />
                {manualId && (
                  <button
                    type="button"
                    onClick={() => setManualId("")}
                    aria-label={t("clear")}
                    className="absolute inset-y-0 right-2 px-1.5 text-slate-500 hover:text-slate-200"
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleConfirmSheetId(manualId)}
                disabled={!manualId || loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
              >
                <Icon name="check" /> {t("useSheet")}
              </button>
              <button
                type="button"
                onClick={handleUseAuto}
                className="w-full py-2.5 text-sm text-slate-300 hover:bg-slate-800 rounded-lg transition"
              >
                {t("autoSheet")}
              </button>
            </div>

            <button
              onClick={() => signOut()}
              className="mt-auto flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg transition"
            >
              <Icon name="logout" /> {t("signOut")}
            </button>
          </aside>
        </div>
      )}

      {/* Add / edit sheet */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="bs-fade absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative bg-[#121821] border border-white/5 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto bs-sheet"
          >
            <div className="sticky top-0 bg-[#121821] flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h2 className="bs-display text-lg font-bold">
                {formMode === "ADD" ? t("addTitle") : t("editTitle")}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                aria-label={t("close")}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSaveBook}
              className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("bookId")} hint={t("auto")}>
                  <input
                    type="text"
                    disabled
                    value={formData.book_id}
                    className={`${field} bg-slate-800/60 font-mono text-teal-300 cursor-not-allowed`}
                  />
                </Field>
                <Field label={t("price")}>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={formData.price}
                    onChange={(e) =>
                      setFormData({ ...formData, price: e.target.value })
                    }
                    className={field}
                  />
                </Field>
              </div>

              <Field label={t("mainTitle")}>
                <input
                  type="text"
                  required
                  value={formData.book_title}
                  onChange={(e) =>
                    setFormData({ ...formData, book_title: e.target.value })
                  }
                  className={field}
                />
              </Field>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label={t("thaiTitle")}>
                  <input
                    type="text"
                    value={formData.th_book_name}
                    onChange={(e) =>
                      setFormData({ ...formData, th_book_name: e.target.value })
                    }
                    className={field}
                  />
                </Field>
                <Field label={t("englishTitle")}>
                  <input
                    type="text"
                    value={formData.en_book_name}
                    onChange={(e) =>
                      setFormData({ ...formData, en_book_name: e.target.value })
                    }
                    className={field}
                  />
                </Field>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label={t("publisher")}>
                  <input
                    type="text"
                    value={formData.publisher}
                    onChange={(e) =>
                      setFormData({ ...formData, publisher: e.target.value })
                    }
                    className={field}
                  />
                </Field>
                <Field label={t("dateAdded")}>
                  <input
                    type="date"
                    value={formData.creation_date}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        creation_date: e.target.value,
                      })
                    }
                    className={field}
                  />
                </Field>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={formData.is_special === "TRUE"}
                onClick={() =>
                  setFormData({
                    ...formData,
                    is_special:
                      formData.is_special === "TRUE" ? "FALSE" : "TRUE",
                  })
                }
                className="w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border border-white/10 hover:bg-white/5 transition"
              >
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <Icon name="star" className="w-4 h-4 text-amber-300" />{" "}
                  {t("specialEdition")}
                </span>
                <span
                  className={`relative w-11 h-6 rounded-full transition-colors duration-300 ${formData.is_special === "TRUE" ? "bg-amber-400" : "bg-slate-700"}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${formData.is_special === "TRUE" ? "translate-x-5" : ""}`}
                  />
                </span>
              </button>

              {formError && (
                <p
                  role="alert"
                  className="p-3 text-sm bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-lg"
                >
                  {formError}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 text-sm font-medium text-slate-300 bg-slate-700/60 hover:bg-slate-700 rounded-lg transition"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 text-sm font-medium text-white bs-btn bg-gradient-to-br from-teal-500 to-teal-600 disabled:opacity-50 rounded-xl active:scale-95"
                >
                  {saving ? t("saving") : t("save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapped in Suspense because useSearchParams requires it in the App Router
export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0b0f14] flex items-center justify-center text-slate-400">
          Loading...
        </div>
      }
    >
      <BookShelfContent />
    </Suspense>
  );
}
