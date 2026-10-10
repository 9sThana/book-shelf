// app/api/sheet-data/route.js
// GET  -> find (or create) the "BookTracker_Data" spreadsheet in the user's Google Drive
//         and return the rows of its "Books" tab
// POST -> add a row (ADD) or update a row (EDIT) in that tab
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { google } from "googleapis";

export const dynamic = "force-dynamic";

const SPREADSHEET_NAME = "BookTracker_Data"; // file name in Google Drive
const TAB_NAME = "Books"; // tab inside the spreadsheet

const DEFAULT_HEADERS = [
  "book_id",
  "book_title",
  "en_book_name",
  "th_book_name",
  "publisher",
  "price",
  "creation_date",
  "is_special",
];

const isValidId = (id) => /^[a-zA-Z0-9-_]+$/.test(id || "");
const buildSheetUrl = (id) =>
  `https://docs.google.com/spreadsheets/d/${id}/edit`;
// "Book Title " -> "book_title": header names in the sheet don't have to match exactly
const normalize = (h) =>
  String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
// 0 -> A, 25 -> Z, 26 -> AA
const colLetter = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
// Typed cells: numbers stay numbers, TRUE/FALSE stay booleans, dates stay text (no locale surprises)
const toCell = (field, v) => {
  if (field === "price") return v === "" || v == null ? "" : Number(v);
  if (field === "is_special") return String(v).toUpperCase() === "TRUE";
  return v == null ? "" : String(v);
};

// Accept a full Google Sheets URL or a bare ID; extract the ID from ".../d/<ID>/..."
function extractSheetId(input) {
  if (!input || input === "null" || input === "undefined") return null;
  const match = String(input).match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match && match[1] ? match[1] : String(input).trim();
}

// Build Google API clients from the access token stored in the encrypted NextAuth cookie.
// (We read the cookie on the server with getToken, so the token is never exposed to browser JS.)
async function getGoogleInstances(request) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  // Work out WHY we are not authorised (shown in the page while developing)
  let reason = "";
  if (!process.env.NEXTAUTH_SECRET)
    reason = "NEXTAUTH_SECRET is not set in .env.local";
  else if (!token)
    reason =
      "no valid session cookie (sign out, clear localhost cookies, sign in again)";
  else if (token.error) reason = `token error: ${token.error} (sign in again)`;
  else if (!token.accessToken)
    reason =
      "session has no Google access token (old login: sign out and sign in again)";
  if (reason) {
    const err = new Error("UNAUTHORIZED");
    err.reason = reason;
    throw err;
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token.accessToken });
  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

// Search Drive for BookTracker_Data. If it doesn't exist yet, create it with the header row.
async function getOrCreateSheet(drive, sheets) {
  const search = await drive.files.list({
    q: `name = '${SPREADSHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id, name)",
    orderBy: "modifiedTime desc",
    pageSize: 1,
    spaces: "drive",
  });
  const file = search.data.files?.[0];
  if (file)
    return { sheetId: file.id, sheetName: file.name, isNewCreated: false };

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SPREADSHEET_NAME },
      sheets: [{ properties: { title: TAB_NAME } }],
    },
  });
  const sheetId = created.data.spreadsheetId;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${TAB_NAME}!A1:H1`,
    valueInputOption: "RAW",
    requestBody: { values: [DEFAULT_HEADERS] },
  });
  return { sheetId, sheetName: SPREADSHEET_NAME, isNewCreated: true };
}

// Turn any error into a JSON response the page can show.
function errorResponse(error, label) {
  if (error.message === "UNAUTHORIZED") {
    const hint =
      process.env.NODE_ENV !== "production" && error.reason
        ? ` [${error.reason}]`
        : "";
    console.error("401 reason:", error.reason);
    return NextResponse.json(
      {
        error: `เซสชันหมดอายุหรือยังไม่ได้อนุญาต Google กรุณาเข้าสู่ระบบใหม่${hint}`,
      },
      { status: 401 },
    );
  }
  const code = Number(error.code) || error.response?.status || 500;
  const reason = error.errors?.[0]?.reason || "";
  const msg = error.message || "Unknown error";
  console.error(label, code, msg);

  // Expired token, or the login was made before Drive/Sheets permission was requested
  if (
    code === 401 ||
    reason === "insufficientPermissions" ||
    /insufficient/i.test(msg)
  ) {
    return NextResponse.json(
      { error: "สิทธิ์ Google ไม่เพียงพอหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่" },
      { status: 401 },
    );
  }
  return NextResponse.json(
    { error: msg },
    { status: [400, 403, 404].includes(code) ? code : 500 },
  );
}

// 🟢 GET
export async function GET(request) {
  try {
    const { sheets, drive } = await getGoogleInstances(request);
    const { searchParams } = new URL(request.url);

    // ?sheetId=... (or ?sheetUrl=...) is an optional manual override
    let sheetId = extractSheetId(
      searchParams.get("sheetUrl") || searchParams.get("sheetId"),
    );
    let sheetName = "";
    let sheetUrl = "";

    if (sheetId) {
      if (!isValidId(sheetId))
        return NextResponse.json(
          { error: "Sheet ID ไม่ถูกต้อง" },
          { status: 400 },
        );
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: sheetId,
        fields: "properties.title",
      });
      sheetName = meta.data.properties?.title || "";
    } else {
      // Default path: find (or create) BookTracker_Data in Drive
      const result = await getOrCreateSheet(drive, sheets);
      sheetId = result.sheetId;
      sheetName = result.sheetName;
      if (result.isNewCreated) {
        return NextResponse.json({
          isNewCreated: true,
          sheetId,
          sheetName,
          sheetUrl: buildSheetUrl(sheetId),
          data: [],
        });
      }
    }
    sheetUrl = buildSheetUrl(sheetId);

    // Read the whole Books tab (no row limit). Row 1 = headers, the rest = books.
    let rows = [];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: TAB_NAME,
      });
      rows = res.data.values || [];
    } catch (e) {
      if (Number(e.code) === 400)
        e.message = `ไม่พบแท็บชื่อ "${TAB_NAME}" ในไฟล์ ${sheetName}`;
      throw e;
    }

    const [headerRow = [], ...body] = rows;
    const headers = headerRow.map(normalize);
    const data = body
      .map((row, i) => ({
        ...Object.fromEntries(headers.map((h, c) => [h, row[c] ?? ""])),
        _rowIndex: i + 2, // real sheet row number (row 1 is the header); used by EDIT
      }))
      .filter((b) => headers.some((h) => h && b[h] !== "")); // skip blank rows

    return NextResponse.json({ sheetId, sheetName, sheetUrl, data });
  } catch (error) {
    return errorResponse(error, "GET Sheet Error:");
  }
}

// 🔵 POST
export async function POST(request) {
  try {
    const { sheets } = await getGoogleInstances(request);
    const body = await request.json().catch(() => ({}));
    const { sheetUrl, sheetId: rawSheetId, action, bookData, rowIndex } = body;
    const sheetId = extractSheetId(sheetUrl || rawSheetId);

    if (!isValidId(sheetId))
      return NextResponse.json(
        { error: "ไม่พบ Sheet URL หรือ ID" },
        { status: 400 },
      );
    if (
      !["ADD", "EDIT"].includes(action) ||
      !bookData ||
      typeof bookData !== "object"
    ) {
      return NextResponse.json({ error: "Action ไม่ถูกต้อง" }, { status: 400 });
    }
    if (action === "EDIT" && !(Number.isInteger(rowIndex) && rowIndex >= 2)) {
      return NextResponse.json(
        { error: "ไม่ระบุตำแหน่งแถวที่จะแก้ไข" },
        { status: 400 },
      );
    }

    // Read row 1 so each value lands in the right column, whatever the column order is
    const head = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TAB_NAME}!1:1`,
    });
    const headers = (head.data.values?.[0] || []).map(normalize);
    if (headers.length === 0) {
      return NextResponse.json(
        { error: `แท็บ ${TAB_NAME} ยังไม่มีหัวตาราง (แถวที่ 1)` },
        { status: 400 },
      );
    }

    if (action === "ADD") {
      // Append at the bottom
      const row = headers.map((h) =>
        DEFAULT_HEADERS.includes(h) ? toCell(h, bookData[h]) : "",
      );
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: TAB_NAME,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });
      return NextResponse.json({ success: true, message: "เพิ่มข้อมูลสำเร็จ" });
    }

    // EDIT: update known columns only (one cell each) so extra columns you added are untouched.
    // book_id is never changed.
    const data = headers
      .map((h, c) => ({ h, c }))
      .filter(({ h }) => DEFAULT_HEADERS.includes(h) && h !== "book_id")
      .map(({ h, c }) => ({
        range: `${TAB_NAME}!${colLetter(c)}${rowIndex}`,
        values: [[toCell(h, bookData[h])]],
      }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "RAW", data },
    });
    return NextResponse.json({ success: true, message: "แก้ไขข้อมูลสำเร็จ" });
  } catch (error) {
    return errorResponse(error, "POST Sheet Error:");
  }
}
