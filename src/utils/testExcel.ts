import ExcelJS from "exceljs";

export type QuestionType = "single" | "multiple" | "true_false" | "fill_blank";

export interface ExcelOption { option_text: string; is_correct: boolean }
export interface ExcelQuestion {
  question_text: string;
  question_type: QuestionType;
  points: number;
  options: ExcelOption[];
}
export interface ExcelTest {
  title: string;
  description: string | null;
  time_limit: number | null;
  test_type: "entry" | "post_topic" | "home_study";
  max_attempts: number | null;
  questions: ExcelQuestion[];
}

const TEST_TYPES: Record<string, ExcelTest["test_type"]> = {
  "Kirish": "entry",
  "Mavzu so'nggi": "post_topic",
  "Mustaqil ta'lim": "home_study",
};
const TEST_TYPES_REV: Record<string, string> = {
  entry: "Kirish",
  post_topic: "Mavzu so'nggi",
  home_study: "Mustaqil ta'lim",
};
const Q_TYPES: Record<string, QuestionType> = {
  "Bir javobli": "single",
  "Ko'p javobli": "multiple",
  "To'g'ri/Noto'g'ri": "true_false",
  "Ochiq javob": "fill_blank",
};
const Q_TYPES_REV: Record<QuestionType, string> = {
  single: "Bir javobli",
  multiple: "Ko'p javobli",
  true_false: "To'g'ri/Noto'g'ri",
  fill_blank: "Ochiq javob",
};

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
const SUBHEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
const WHITE_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
const DARK_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FF1F3864" }, size: 11 };
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" }, left: { style: "thin" },
  bottom: { style: "thin" }, right: { style: "thin" },
};

export async function generateTestExcel(test: ExcelTest): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "I-Imkon.uz";

  // ── Sheet 1: Test ma'lumotlari ──────────────────────────────────────────────
  const s1 = wb.addWorksheet("Test ma'lumotlari");
  s1.columns = [
    { key: "key", width: 30 },
    { key: "val", width: 50 },
  ];

  const addInfoRow = (key: string, val: string | number | null, isHeader = false) => {
    const row = s1.addRow([key, val ?? ""]);
    if (isHeader) {
      row.getCell(1).fill = HEADER_FILL;
      row.getCell(1).font = WHITE_FONT;
      row.getCell(2).fill = HEADER_FILL;
      row.getCell(2).font = WHITE_FONT;
    } else {
      row.getCell(1).fill = SUBHEADER_FILL;
      row.getCell(1).font = DARK_FONT;
    }
    row.getCell(1).border = BORDER;
    row.getCell(2).border = BORDER;
  };

  addInfoRow("MAYDON", "QIYMAT", true);
  addInfoRow("Sarlavha *", test.title);
  addInfoRow("Tavsif", test.description ?? "");
  addInfoRow("Vaqt (daqiqa)", test.time_limit ?? "");
  addInfoRow("Test turi *", TEST_TYPES_REV[test.test_type]);
  addInfoRow("Max urinish", test.max_attempts ?? "");

  s1.addRow([]);
  const noteRow = s1.addRow(["Test turlari: Kirish | Mavzu so'nggi | Mustaqil ta'lim"]);
  noteRow.getCell(1).font = { italic: true, color: { argb: "FF666666" }, size: 9 };
  s1.mergeCells(`A${noteRow.number}:B${noteRow.number}`);

  // ── Sheet 2: Savollar ───────────────────────────────────────────────────────
  const s2 = wb.addWorksheet("Savollar");
  s2.columns = [
    { key: "num",    width: 5,  header: "№" },
    { key: "q",      width: 50, header: "Savol matni *" },
    { key: "type",   width: 20, header: "Tur *" },
    { key: "points", width: 8,  header: "Ball" },
    { key: "a",      width: 25, header: "A" },
    { key: "b",      width: 25, header: "B" },
    { key: "c",      width: 25, header: "C" },
    { key: "d",      width: 25, header: "D" },
    { key: "ans",    width: 30, header: "To'g'ri javob *" },
  ];

  const hRow = s2.getRow(1);
  hRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = WHITE_FONT;
    cell.border = BORDER;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  hRow.height = 30;

  for (const [i, q] of test.questions.entries()) {
    const opts = q.options;
    let answerText = "";

    if (q.question_type === "single") {
      const idx = opts.findIndex((o) => o.is_correct);
      answerText = ["A", "B", "C", "D"][idx] ?? "";
    } else if (q.question_type === "multiple") {
      answerText = opts
        .map((o, j) => (o.is_correct ? ["A", "B", "C", "D"][j] : null))
        .filter(Boolean)
        .join(",");
    } else if (q.question_type === "true_false") {
      answerText = opts[0]?.is_correct ? "To'g'ri" : "Noto'g'ri";
    } else {
      answerText = opts[0]?.option_text ?? "";
    }

    const row = s2.addRow({
      num:    i + 1,
      q:      q.question_text,
      type:   Q_TYPES_REV[q.question_type],
      points: q.points,
      a:      opts[0]?.option_text ?? "",
      b:      opts[1]?.option_text ?? "",
      c:      opts[2]?.option_text ?? "",
      d:      opts[3]?.option_text ?? "",
      ans:    answerText,
    });

    row.eachCell((cell) => {
      cell.border = BORDER;
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    row.height = 20;
    const fill = i % 2 === 0
      ? { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF9FBFF" } }
      : { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFFFFF" } };
    row.eachCell((cell) => { cell.fill = fill; });
  }

  // Note row
  s2.addRow([]);
  const n1 = s2.addRow(["Savol turlari: Bir javobli | Ko'p javobli | To'g'ri/Noto'g'ri | Ochiq javob"]);
  n1.getCell(1).font = { italic: true, color: { argb: "FF666666" }, size: 9 };
  s2.mergeCells(`A${n1.number}:I${n1.number}`);

  const n2 = s2.addRow(["Ko'p javoblida to'g'ri javoblar vergul bilan: A,C yoki A,B,D"]);
  n2.getCell(1).font = { italic: true, color: { argb: "FF666666" }, size: 9 };
  s2.mergeCells(`A${n2.number}:I${n2.number}`);

  s2.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function parseTestExcel(buffer: Buffer | ArrayBuffer): Promise<ExcelTest> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  const s1 = wb.getWorksheet("Test ma'lumotlari") ?? wb.worksheets[0];
  const s2 = wb.getWorksheet("Savollar") ?? wb.worksheets[1];

  if (!s1 || !s2) throw new Error("Excel formati noto'g'ri: ikkita sheet kerak");

  const getCell = (row: number, col: number): string =>
    String(s1.getRow(row).getCell(col).value ?? "").trim();

  const title      = getCell(2, 2);
  const desc       = getCell(3, 2) || null;
  const timeStr    = getCell(4, 2);
  const testTypeRaw = getCell(5, 2);
  const maxAttemptStr = getCell(6, 2);

  if (!title) throw new Error("Sarlavha bo'sh bo'lmasligi kerak");

  const test_type = TEST_TYPES[testTypeRaw] ?? "home_study";
  const time_limit = timeStr ? parseInt(timeStr) || null : null;
  const max_attempts = maxAttemptStr ? parseInt(maxAttemptStr) || null : null;

  const questions: ExcelQuestion[] = [];
  s2.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // header
    const getVal = (col: number) => String(row.getCell(col).value ?? "").trim();
    const questionText = getVal(2);
    if (!questionText || questionText.startsWith("Savol")) return;

    const typeRaw = getVal(3);
    const question_type: QuestionType = Q_TYPES[typeRaw] ?? "single";
    const points = parseInt(getVal(4)) || 1;
    const a = getVal(5), b = getVal(6), c = getVal(7), d = getVal(8);
    const answerRaw = getVal(9).trim();

    let options: ExcelOption[] = [];

    if (question_type === "true_false") {
      const correct = answerRaw === "To'g'ri";
      options = [
        { option_text: "To'g'ri", is_correct: correct },
        { option_text: "Noto'g'ri", is_correct: !correct },
      ];
    } else if (question_type === "fill_blank") {
      options = [{ option_text: answerRaw, is_correct: true }];
    } else if (question_type === "multiple") {
      const correctLetters = answerRaw.toUpperCase().split(",").map((s) => s.trim());
      const letters = ["A", "B", "C", "D"];
      [a, b, c, d].forEach((text, i) => {
        if (text) options.push({ option_text: text, is_correct: correctLetters.includes(letters[i]) });
      });
    } else {
      const correctLetter = answerRaw.toUpperCase().trim();
      const letters = ["A", "B", "C", "D"];
      [a, b, c, d].forEach((text, i) => {
        if (text) options.push({ option_text: text, is_correct: letters[i] === correctLetter });
      });
    }

    questions.push({ question_text: questionText, question_type, points, options });
  });

  if (questions.length === 0) throw new Error("Hech qanday savol topilmadi");

  return { title, description: desc, time_limit, test_type, max_attempts, questions };
}
