import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";

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

// Helper ตั้งค่า Google Sheets Instance
async function getSheetsInstance() {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    throw new Error("UNAUTHORIZED");
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: session.accessToken });
  return { sheets: google.sheets({ version: "v4", auth }), session };
}

// 🟢 GET: ดึงข้อมูล หรือ สร้าง Sheet ใหม่ถ้ายังไม่มี
export async function GET(request) {
  try {
    const { sheets } = await getSheetsInstance();
    const { searchParams } = new URL(request.url);
    let sheetId = searchParams.get("sheetId");

    // 1. ถ้าไม่มี sheetId ส่งมา ให้สร้าง Google Sheet ใหม่ทันที
    if (!sheetId || sheetId === "null" || sheetId === "undefined") {
      const newSpreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: "Book Shelf DB" },
          sheets: [{ properties: { title: "Books" } }],
        },
      });

      sheetId = newSpreadsheet.data.spreadsheetId;

      // เขียน Header คอลัมน์เริ่มต้น
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: "Books!A1:H1",
        valueInputOption: "RAW",
        requestBody: { values: [DEFAULT_HEADERS] },
      });

      return NextResponse.json({
        isNewCreated: true,
        sheetId: sheetId,
        data: [],
      });
    }

    // 2. ดึงข้อมูลจาก Sheet ที่มีอยู่
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "A1:Z1000",
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      return NextResponse.json({ sheetId, data: [] });
    }

    const headers = rows[0];
    const data = rows.slice(1).map((row, rowIndex) => {
      const rowData = { _rowIndex: rowIndex + 2 };

      headers.forEach((header, index) => {
        // Safe key matching
        const cleanHeader = String(header).trim();
        rowData[cleanHeader] = row[index] || "";
      });

      return rowData;
    });

    return NextResponse.json({ sheetId, data });
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
    const { sheets } = await getSheetsInstance();
    const body = await request.json();
    const { sheetId, action, bookData, rowIndex } = body;

    if (!sheetId) {
      return NextResponse.json({ error: "ไม่พบ Sheet ID" }, { status: 400 });
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
