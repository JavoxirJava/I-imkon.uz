import ExcelJS from "exceljs";

// =============================================================
// Tiplar
// =============================================================

export type QuestionType = "single" | "multiple" | "true_false" | "fill_blank";
export type TestType = "entry" | "post_topic" | "home_study";

export interface TestExcelOption {
  option_text: string;
  is_correct: boolean;
}

export interface TestExcelQuestion {
  question_text: string;
  question_type: QuestionType;
  points: number;
  options: TestExcelOption[];
}

export interface TestExcelData {
  title: string;
  description?: string | null;
  time_limit?: number | null;
  test_type: TestType;
  max_attempts?: number | null;
  questions: TestExcelQuestion[];
}

export interface ParsedTestQuestion extends TestExcelQuestion {
  image_url: string | null;
  image_alt: string | null;
}

export interface ParsedTest {
  title: string;
  description: string | null;
  time_limit: number | null;
  test_type: TestType;
  max_attempts: number | null;
  questions: ParsedTestQuestion[];
}

const QUESTION_TYPES: QuestionType[] = ["single", "multiple", "true_false", "fill_blank"];
const TEST_TYPES: TestType[] = ["entry", "post_topic", "home_study"];

const LABEL = {
  title: "Sarlavha",
  description: "Tavsif",
  time_limit: "Vaqt chegarasi (daqiqa)",
  test_type: "Test turi (entry / post_topic / home_study)",
  max_attempts: "Urinishlar soni",
} as const;

// =============================================================
// Yordamchilar
// =============================================================

// Apostrof variantlarini olib tashlab, kichik harfga keltiradi (taqqoslash uchun).
function norm(value: string): string {
  return value.replace(/['’‘`ʻ]/g, "").trim().toLowerCase();
}

// ExcelJS katak qiymatini matnga aylantiradi (rich text / formula / sana'ni ham).
function cellText(cell: ExcelJS.Cell | undefined): string {
  const v = cell?.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    }
    if (o.result !== undefined && o.result !== null) return String(o.result);
  }
  return "";
}

function cellNumber(cell: ExcelJS.Cell | undefined): number | null {
  const text = cellText(cell).trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// =============================================================
// Excel yaratish (shablon / eksport)
// =============================================================

export async function generateTestExcel(data: TestExcelData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "I-Imkon.uz";
  const ws = wb.addWorksheet("Test");

  // Metama'lumotlar
  ws.addRow([LABEL.title, data.title]);
  ws.addRow([LABEL.description, data.description ?? ""]);
  ws.addRow([LABEL.time_limit, data.time_limit ?? ""]);
  ws.addRow([LABEL.test_type, data.test_type]);
  ws.addRow([LABEL.max_attempts, data.max_attempts ?? ""]);
  ws.getColumn(1).font = { bold: true };
  ws.addRow([]);

  // Savollar jadvali sarlavhasi
  const maxOptions = Math.max(4, ...data.questions.map((q) => q.options.length), 0);
  const optionHeaders = Array.from({ length: maxOptions }, (_, i) => `Variant ${i + 1}`);
  const headerRow = ws.addRow([
    "№",
    "Savol matni",
    "Savol turi",
    "Ball",
    ...optionHeaders,
    "To'g'ri variant(lar) (masalan: 1,3)",
  ]);
  headerRow.font = { bold: true };

  // Savollar
  data.questions.forEach((q, idx) => {
    const optionTexts = Array.from({ length: maxOptions }, (_, i) => q.options[i]?.option_text ?? "");
    const correct = q.options
      .map((o, i) => (o.is_correct ? i + 1 : null))
      .filter((v): v is number => v !== null)
      .join(",");
    ws.addRow([idx + 1, q.question_text, q.question_type, q.points, ...optionTexts, correct]);
  });

  // Ustun kengliklari (ko'rinish uchun)
  ws.getColumn(2).width = 45;
  ws.getColumn(3).width = 14;

  // ExcelJS writeBuffer() ish vaqtida Node Buffer qaytaradi; @types/node generic
  // `Buffer` nuancelaridan saqlanish uchun cast qilamiz (asl xulq-atvor saqlanadi).
  const buf = await wb.xlsx.writeBuffer();
  return buf as unknown as Buffer;
}

// =============================================================
// Excel'ni o'qish (import)
// =============================================================

export async function parseTestExcel(buffer: Buffer): Promise<ParsedTest> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel faylida varaq topilmadi");

  let title = "";
  let description: string | null = null;
  let timeLimit: number | null = null;
  let maxAttempts: number | null = null;
  let testType: TestType = "home_study";
  let headerRowNum = -1;

  // Sarlavha qatorini topish + metama'lumotlarni o'qish
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const label = norm(cellText(row.getCell(1)));
    const second = norm(cellText(row.getCell(2)));

    if (second === "savol matni" || label === "№" || label === "no" || label === "#") {
      headerRowNum = r;
      break;
    }

    const value = row.getCell(2);
    if (label.startsWith("sarlavha")) {
      title = cellText(value).trim();
    } else if (label.startsWith("tavsif")) {
      const t = cellText(value).trim();
      description = t === "" ? null : t;
    } else if (label.startsWith("vaqt")) {
      timeLimit = cellNumber(value);
    } else if (label.startsWith("test turi")) {
      const t = norm(cellText(value)) as TestType;
      if (TEST_TYPES.includes(t)) testType = t;
    } else if (label.startsWith("urinish")) {
      maxAttempts = cellNumber(value);
    }
  }

  if (headerRowNum < 0) throw new Error("Savollar jadvali sarlavhasi topilmadi");
  if (title === "") throw new Error("Test sarlavhasi (Sarlavha) kiritilmagan");

  // Ustun joylashuvini sarlavha qatoridan aniqlash
  let textCol = 2;
  let typeCol = 3;
  let pointsCol = 4;
  let correctCol = -1;
  const optionCols: number[] = [];

  ws.getRow(headerRowNum).eachCell((cell, colNumber) => {
    const h = norm(cellText(cell));
    if (h === "savol matni") textCol = colNumber;
    else if (h.startsWith("savol turi")) typeCol = colNumber;
    else if (h === "ball") pointsCol = colNumber;
    else if (h.startsWith("variant")) optionCols.push(colNumber);
    else if (h.startsWith("togri")) correctCol = colNumber;
  });
  optionCols.sort((a, b) => a - b);

  const questions: ParsedTestQuestion[] = [];

  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const questionText = cellText(row.getCell(textCol)).trim();
    if (questionText === "") continue; // bo'sh qatorlarni o'tkazib yuborish

    const rawType = norm(cellText(row.getCell(typeCol)));
    const questionType: QuestionType = (QUESTION_TYPES as string[]).includes(rawType)
      ? (rawType as QuestionType)
      : "single";
    const points = cellNumber(row.getCell(pointsCol)) ?? 1;

    const correctRaw = correctCol > 0 ? cellText(row.getCell(correctCol)) : "";
    const correctIndexes = new Set(
      correctRaw
        .split(/[,\s;]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => !Number.isNaN(n)),
    );

    const options: TestExcelOption[] = [];
    optionCols.forEach((col, i) => {
      const optionText = cellText(row.getCell(col)).trim();
      if (optionText !== "") {
        options.push({ option_text: optionText, is_correct: correctIndexes.has(i + 1) });
      }
    });

    questions.push({
      question_text: questionText,
      question_type: questionType,
      points,
      options,
      image_url: null,
      image_alt: null,
    });
  }

  if (questions.length === 0) throw new Error("Faylda birorta savol topilmadi");

  return {
    title,
    description,
    time_limit: timeLimit,
    test_type: testType,
    max_attempts: maxAttempts,
    questions,
  };
}
