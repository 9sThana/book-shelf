import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";

const SPREADSHEET_NAME = "BookTracker_Data";

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

// 🔹 Helper สกัด Sheet ID ออกมาจาก URL หรือ ID
function extractSheetId(input) {
  if (!input || input === "null" || input === "undefined") return null;
  const match = String(input).match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match && match[1] ? match[1] : String(input).trim();
}

// 🔹 Helper สร้าง URL เต็มจาก Sheet ID
function buildSheetUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

// 🔹 Helper ตั้งค่า Google APIs Instance (ทั้ง Sheets และ Drive)
async function getGoogleInstances() {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    throw new Error("UNAUTHORIZED");
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: session.accessToken });

  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
    session,
  };
}

// 🔹 Helper ค้นหา หรือ สร้าง Sheet "BookTracker_Data" ใน Google Drive
async function getOrCreateSheet(drive, sheets) {
  // 1. ค้นหาไฟล์ Sheet ชื่อ "BookTracker_Data" ใน Drive ของ User ก่อน
  const searchResponse = await drive.files.list({
    q: `name = '${SPREADSHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive",
  });

  const existingFiles = searchResponse.data.files;

  // 2. ถ้าเจอไฟล์เดิม ให้คืนค่า ID และ URL ของไฟล์นั้นเลย (ข้ามเครื่องก็เจอ)
  if (existingFiles && existingFiles.length > 0) {
    const id = existingFiles[0].id;
    return {
      sheetId: id,
      sheetUrl: buildSheetUrl(id),
      isNewCreated: false,
    };
  }

  // 3. ถ้ายังไม่มี ให้สร้าง Sheet ใหม่ชื่อ BookTracker_Data
  const newSpreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SPREADSHEET_NAME },
      sheets: [{ properties: { title: "Books" } }],
    },
  });

  const newSheetId = newSpreadsheet.data.spreadsheetId;

  // เขียน Header คอลัมน์เริ่มต้น
  await sheets.spreadsheets.values.update({
    spreadsheetId: newSheetId,
    range: "Books!A1:H1",
    valueInputOption: "RAW",
    requestBody: { values: [DEFAULT_HEADERS] },
  });

  return {
    sheetId: newSheetId,
    sheetUrl: buildSheetUrl(newSheetId),
    isNewCreated: true,
  };
}

// 🟢 GET: ดึงข้อมูล หรือ ดึง/สร้าง Sheet ผ่าน Google Drive อัตโนมัติ
export async function GET(request) {
  try {
    const { sheets, drive } = await getGoogleInstances();
    const { searchParams } = new URL(request.url);

    // รับค่าได้ทั้ง ?sheetUrl=... หรือ ?sheetId=...
    const rawInput =
      searchParams.get("sheetUrl") || searchParams.get("sheetId");
    let sheetId = extractSheetId(rawInput);
    let sheetUrl = sheetId ? buildSheetUrl(sheetId) : null;

    // หากไม่มี sheetUrl หรือ sheetId ส่งมา ให้ค้นหา/สร้าง อัตโนมัติผ่าน Drive
    if (!sheetId) {
      const result = await getOrCreateSheet(drive, sheets);
      sheetId = result.sheetId;
      sheetUrl = result.sheetUrl;

      if (result.isNewCreated) {
        return NextResponse.json({
          isNewCreated: true,
          sheetId,
          sheetUrl,
          data: [],
        });
      }
    }

    // ดึงข้อมูลจาก Sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Books!A1:Z1000",
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      return NextResponse.json({ sheetId, sheetUrl, data: [] });
    }

    const headers = rows[0];
    const data = rows.slice(1).map((row, rowIndex) => {
      const rowData = { _rowIndex: rowIndex + 2 };

      headers.forEach((header, index) => {
        const cleanHeader = String(header).trim();
        rowData[cleanHeader] = row[index] || "";
      });

      return rowData;
    });

    return NextResponse.json({ sheetId, sheetUrl, data });
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "กรุณาล็อกอินก่อนครับ" },
        { status: 401 },
      );
    }
    console.error("GET Sheet Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 🔵 POST: เพิ่มหนังสือใหม่ หรือ แก้ไขหนังสือเดิม
export async function POST(request) {
  try {
    const { sheets } = await getGoogleInstances();
    const body = await request.json();
    const { sheetUrl, sheetId: rawSheetId, action, bookData, rowIndex } = body;

    // รองรับทั้งการส่ง sheetUrl หรือ sheetId มาใน Body
    const sheetId = extractSheetId(sheetUrl || rawSheetId);

    if (!sheetId) {
      return NextResponse.json(
        { error: "ไม่พบ Sheet URL หรือ ID" },
        { status: 400 },
      );
    }

    // เรียงลำดับข้อมูลให้ตรงกับ Column Header
    const rowValues = DEFAULT_HEADERS.map((header) => bookData[header] ?? "");

    if (action === "ADD") {
      // เพิ่มแถวใหม่ต่อท้าย
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: "Books!A:H",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowValues] },
      });
      return NextResponse.json({ success: true, message: "เพิ่มข้อมูลสำเร็จ" });
    }

    if (action === "EDIT") {
      // แก้ไขแถวเดิมตาม rowIndex
      if (!rowIndex) {
        return NextResponse.json(
          { error: "ไม่ระบุตำแหน่งแถวที่จะแก้ไข" },
          { status: 400 },
        );
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Books!A${rowIndex}:H${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowValues] },
      });
      return NextResponse.json({ success: true, message: "แก้ไขข้อมูลสำเร็จ" });
    }

    return NextResponse.json({ error: "Action ไม่ถูกต้อง" }, { status: 400 });
  } catch (error) {
    console.error("POST Sheet Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
