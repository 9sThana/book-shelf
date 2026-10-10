"use client";

/**
 * BOOK SHELF: how this page works
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

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
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

const ITEMS_PER_PAGE = 12;
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

const Fonts = () => (
  <style>{`
    .bs-root { color-scheme: dark; --ease: cubic-bezier(.22,1,.36,1); font-family: var(--font-anuphan), 'Noto Sans Thai', ui-sans-serif, system-ui, sans-serif; }
    .bs-display { font-family: var(--font-prompt), var(--font-anuphan), ui-sans-serif, system-ui, sans-serif; letter-spacing: -0.01em; }
    .bs-root :focus-visible { outline: 2px solid #2dd4bf; outline-offset: 2px; }

    /* Ambient background: two soft glows that drift slowly behind everything */
    .bs-bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
    .bs-bg::before, .bs-bg::after { content: ""; position: absolute; border-radius: 50%; animation: bs-drift 22s ease-in-out infinite alternate; }
    .bs-bg::before { width: 44rem; height: 44rem; left: -12rem; top: -16rem; background: radial-gradient(circle, rgba(45,212,191,.17), transparent 65%); }
    .bs-bg::after { width: 40rem; height: 40rem; right: -12rem; top: 18%; background: radial-gradient(circle, rgba(139,92,246,.15), transparent 65%); animation-delay: -9s; }
    @keyframes bs-drift { to { transform: translate(4rem, 3rem) scale(1.12); } }

    /* Entrances: --i sets the stagger order */
    @keyframes bs-rise { from { opacity: 0; transform: translateY(16px) scale(.98); } to { opacity: 1; transform: none; } }
    .bs-rise { animation: bs-rise .6s var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms); }
    @keyframes bs-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
    .bs-grow { transform-origin: bottom; animation: bs-grow .9s var(--ease) both; animation-delay: calc(var(--i, 0) * 90ms); }
    @keyframes bs-fade { from { opacity: 0; } to { opacity: 1; } }
    .bs-fade { animation: bs-fade .25s ease-out both; }
    @keyframes bs-sheet { from { transform: translateY(32px) scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }
    .bs-sheet { animation: bs-sheet .38s var(--ease) both; }
    @keyframes bs-drawer { from { transform: translateX(100%); } to { transform: none; } }
    .bs-drawer { animation: bs-drawer .4s var(--ease) both; }
    @keyframes bs-shimmer { to { background-position: -200% 0; } }
    .bs-skel { background: linear-gradient(90deg, rgba(30,41,59,.5) 25%, rgba(51,65,85,.55) 50%, rgba(30,41,59,.5) 75%); background-size: 200% 100%; animation: bs-shimmer 1.4s linear infinite; }

    /* Cards: lift + glow in the spine colour on hover; special editions get a slow sheen */
    .bs-card { position: relative; transition: transform .4s var(--ease), box-shadow .4s var(--ease), border-color .3s; }
    .bs-card:hover { transform: translateY(-4px); box-shadow: 0 22px 44px -22px var(--spine); }
    .bs-spine { transition: width .4s var(--ease); }
    .bs-card:hover .bs-spine { width: .8rem; }
    @keyframes bs-sheen { to { transform: translateX(130%); } }
    .bs-special::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; background: linear-gradient(110deg, transparent 30%, rgba(251,191,36,.13) 50%, transparent 70%); transform: translateX(-130%); animation: bs-sheen 4s ease-in-out infinite; }

    /* Buttons */
    .bs-btn { transition: transform .2s var(--ease), box-shadow .25s, background .25s; }
    .bs-btn:hover { box-shadow: 0 10px 26px -10px rgba(45,212,191,.7); }
    @keyframes bs-ring { 0% { box-shadow: 0 0 0 0 rgba(45,212,191,.55); } 100% { box-shadow: 0 0 0 20px rgba(45,212,191,0); } }
    .bs-fab { animation: bs-ring 2.4s ease-out 1.2s 2; }
    .bs-glass { background: rgba(18,24,33,.6); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
    .bs-gradient-text { padding-block: .12em; background: linear-gradient(120deg, #e2e8f0 10%, #5eead4 55%, #a78bfa); -webkit-background-clip: text; background-clip: text; color: transparent; }

    @media (prefers-reduced-motion: reduce) {
      .bs-root *, .bs-root *::before, .bs-root *::after, .bs-bg::before, .bs-bg::after { animation: none !important; transition: none !important; }
    }
  `}</style>
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

function BookShelfContent() {
  // ---- Auth & routing ----
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [currentPage, setCurrentPage] = useState(readPage(searchParams));

  // Add / edit form state (formMode decides which action is sent to the API).
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState("ADD");
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [targetRowIndex, setTargetRowIndex] = useState(null);

  // Runs once when the user becomes logged in (not on every session refresh): load the books.
  useEffect(() => {
    if (status === "authenticated") {
      // A manual override (if any) was saved earlier; otherwise "" => auto-find BookTracker_Data.
      const saved = localStorage.getItem("saved_sheet_id") || "";
      setManualId(saved);
      fetchBooks(saved);
    }
  }, [status]);

  // Keep state in sync when the URL changes (browser Back / Forward).
  useEffect(() => {
    setCurrentPage(readPage(searchParams));
  }, [searchParams]);

  // Change page and write it into the URL (?page=N) without scrolling to top.
  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
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

  // Use a specific spreadsheet instead of the automatic one, and remember it.
  const handleConfirmSheetId = (id) => {
    if (!id) return;
    localStorage.setItem("saved_sheet_id", id);
    fetchBooks(id);
    setIsSettingsOpen(false);
  };

  // Forget the override and go back to auto-finding "BookTracker_Data" in Drive.
  const handleUseAuto = () => {
    localStorage.removeItem("saved_sheet_id");
    setManualId("");
    fetchBooks("");
    setIsSettingsOpen(false);
  };

  // Load books from the API. targetId "" => the server finds BookTracker_Data itself.
  const fetchBooks = async (targetId = "", isRetry = false) => {
    setLoading(true);
    setError("");
    setAuthError(false);
    try {
      const res = await fetch(
        `/api/sheet-data?sheetId=${encodeURIComponent(targetId || "")}`,
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
      if (res.status === 404 && targetId && !isRetry) {
        localStorage.removeItem("saved_sheet_id");
        setManualId("");
        return fetchBooks("", true);
      }
      if (!res.ok)
        throw new Error(result.error || "Could not load your books.");

      setBooks(result.data || []);
      setSheetId(result.sheetId);
      setSheetName(result.sheetName || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
      handlePageChange(totalPages);
    }
  }, [totalPages, loading, books.length]);

  // ---- Render: loading -> logged out -> main app ----
  if (status === "loading") {
    return (
      <div className="bs-root min-h-[100dvh] bg-[#0b0f14] flex items-center justify-center text-slate-400 gap-3">
        <Fonts />
        <Icon name="refresh" className="w-5 h-5 text-teal-400" spin />
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="bs-root min-h-[100dvh] bg-[#0b0f14] relative isolate flex items-center justify-center p-5">
        <Fonts />
        <div className="bs-bg" aria-hidden />
        <div className="w-full max-w-md">
          <div className="flex gap-1 mb-8" aria-hidden>
            {SPINES.slice(0, 6).map((c, i) => (
              <div
                key={c}
                className="bs-grow flex-1 rounded-t-md"
                style={{
                  background: c,
                  height: 48 + ((i * 17) % 40),
                  "--i": i,
                }}
              />
            ))}
          </div>
          <h1
            style={{ "--i": 6 }}
            className="bs-rise bs-display text-4xl font-semibold text-slate-100 leading-snug"
          >
            Book Shelf
          </h1>
          <p
            style={{ "--i": 7 }}
            className="bs-rise mt-3 text-slate-400 leading-relaxed"
          >
            Keep your book list in Google Sheets, then search, add and edit it
            from here.
          </p>
          <button
            onClick={() => signIn("google")}
            style={{ "--i": 8 }}
            className="bs-btn bs-rise mt-8 w-full py-3.5 bg-gradient-to-br from-teal-500 to-teal-600 text-white font-medium rounded-xl active:scale-[0.99]"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bs-root relative isolate min-h-[100dvh] bg-[#0b0f14] text-slate-100">
      <Fonts />
      <div className="bs-bg" aria-hidden />

      {/* Top bar */}
      <header className="sticky top-0 z-30 pt-[env(safe-area-inset-top)] bg-[#0b0f14]/70 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <div className="mr-auto flex items-center gap-2.5">
            <span className="flex items-end gap-[3px] h-6" aria-hidden>
              {["#2dd4bf", "#a78bfa", "#f472b6"].map((c, i) => (
                <i
                  key={c}
                  className="bs-grow w-1.5 rounded-sm"
                  style={{ background: c, height: 14 + i * 5, "--i": i }}
                />
              ))}
            </span>
            <span className="bs-display text-xl font-bold">Book Shelf</span>
          </div>
          <button
            onClick={() => fetchBooks(sheetId)}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
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
            <span className="hidden sm:inline">Account & sheet</span>
          </button>
          <button
            onClick={openAddModal}
            className="bs-btn hidden sm:flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-br from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white text-sm font-medium rounded-xl active:scale-95"
          >
            <Icon name="plus" /> Add book
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

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-28 sm:py-8 space-y-6">
        {/* Summary */}
        <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div>
            <h1 className="bs-rise bs-display bs-gradient-text text-3xl sm:text-4xl font-semibold leading-snug">
              Your library
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {sheetName
                ? `${sheetName} › Books`
                : "Connecting to Google Sheets"}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 w-full sm:w-auto sm:flex sm:gap-4 text-sm">
            {[
              ["Books", countBooks, ""],
              ["Special editions", countSpecial, ""],
              ["Total value", countTotal.toLocaleString(), "฿"],
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
            placeholder="Search by title, publisher or ID"
            className={`${field} pl-11 pr-11 py-3.5 rounded-2xl backdrop-blur`}
          />
          {searchTerm && (
            <button
              onClick={() => {
                setSearchTerm("");
                handlePageChange(1);
              }}
              aria-label="Clear search"
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
                Sign in again
              </button>
            ) : (
              <button
                onClick={() => fetchBooks(sheetId)}
                className="font-medium underline"
              >
                Try again
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
              No books in this sheet yet
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Add your first book to get started.
            </p>
            <button
              onClick={openAddModal}
              className="mt-5 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition"
            >
              Add your first book
            </button>
          </div>
        ) : filteredBooks.length === 0 ? (
          <div className="py-20 text-center">
            <p className="bs-display text-xl font-bold">
              No results for "{searchTerm}"
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Try a different word or check the spelling.
            </p>
            <button
              onClick={() => {
                setSearchTerm("");
                handlePageChange(1);
              }}
              className="mt-4 text-sm font-medium text-teal-400 hover:underline"
            >
              Clear search
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
                          <Icon name="star" className="w-3 h-3" /> Special
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
                          {book.publisher || "No publisher"}
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
                        <Icon name="edit" className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => openDuplicateModal(book)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 hover:text-white active:scale-95 rounded-lg transition"
                        title="Create a new entry from this book"
                      >
                        <Icon name="copy" className="w-3.5 h-3.5" /> Duplicate
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
              Showing {paginatedBooks.length} of {filteredBooks.length} books
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handlePageChange(Math.max(currentPage - 1, 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-slate-200 hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Previous
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
                Next
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
              <h2 className="bs-display text-lg font-bold">Account & sheet</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3 p-3 bg-slate-900/60 rounded-xl border border-slate-800">
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
                <Icon name="sheet" className="w-4 h-4 text-teal-400" /> Google
                Sheet
              </label>
              <p className="text-xs text-slate-400">
                We look for a file named "BookTracker_Data" (tab: Books) in your
                Google Drive automatically. Use this field only to switch to a
                different file.
              </p>
              <div className="relative">
                <input
                  id="sheet-id"
                  type="text"
                  value={manualId}
                  onChange={(e) =>
                    setManualId(handleSheetInput(e.target.value))
                  }
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className={`${field} pr-10`}
                />
                {manualId && (
                  <button
                    type="button"
                    onClick={() => setManualId("")}
                    aria-label="Clear"
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
                <Icon name="check" /> Use this sheet
              </button>
              <button
                type="button"
                onClick={handleUseAuto}
                className="w-full py-2.5 text-sm text-slate-300 hover:bg-slate-800 rounded-lg transition"
              >
                Back to automatic BookTracker_Data
              </button>
            </div>

            <button
              onClick={() => signOut()}
              className="mt-auto flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg transition"
            >
              <Icon name="logout" /> Sign out
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
                {formMode === "ADD" ? "Add a book" : "Edit book"}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
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
                <Field label="Book ID" hint="Auto">
                  <input
                    type="text"
                    disabled
                    value={formData.book_id}
                    className={`${field} bg-slate-800/60 font-mono text-teal-300 cursor-not-allowed`}
                  />
                </Field>
                <Field label="Price (THB)">
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

              <Field label="Main title">
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
                <Field label="Thai title">
                  <input
                    type="text"
                    value={formData.th_book_name}
                    onChange={(e) =>
                      setFormData({ ...formData, th_book_name: e.target.value })
                    }
                    className={field}
                  />
                </Field>
                <Field label="English title">
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
                <Field label="Publisher">
                  <input
                    type="text"
                    value={formData.publisher}
                    onChange={(e) =>
                      setFormData({ ...formData, publisher: e.target.value })
                    }
                    className={field}
                  />
                </Field>
                <Field label="Date added">
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
                  Special edition
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
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 text-sm font-medium text-white bs-btn bg-gradient-to-br from-teal-500 to-teal-600 disabled:opacity-50 rounded-xl active:scale-95"
                >
                  {saving ? "Saving..." : "Save"}
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
