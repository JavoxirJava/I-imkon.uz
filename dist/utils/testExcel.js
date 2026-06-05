"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTestExcel = generateTestExcel;
exports.parseTestExcel = parseTestExcel;
const exceljs_1 = __importDefault(require("exceljs"));
const QUESTION_TYPES = ["single", "multiple", "true_false", "fill_blank"];
const TEST_TYPES = ["entry", "post_topic", "home_study"];
const LABEL = {
    title: "Sarlavha",
    description: "Tavsif",
    time_limit: "Vaqt chegarasi (daqiqa)",
    test_type: "Test turi (entry / post_topic / home_study)",
    max_attempts: "Urinishlar soni",
};
// =============================================================
// Yordamchilar
// =============================================================
// Apostrof variantlarini olib tashlab, kichik harfga keltiradi (taqqoslash uchun).
function norm(value) {
    return value.replace(/['’‘`ʻ]/g, "").trim().toLowerCase();
}
// ExcelJS katak qiymatini matnga aylantiradi (rich text / formula / sana'ni ham).
function cellText(cell) {
    const v = cell?.value;
    if (v === null || v === undefined)
        return "";
    if (typeof v === "string")
        return v;
    if (typeof v === "number" || typeof v === "boolean")
        return String(v);
    if (v instanceof Date)
        return v.toISOString();
    if (typeof v === "object") {
        const o = v;
        if (typeof o.text === "string")
            return o.text;
        if (Array.isArray(o.richText)) {
            return o.richText.map((r) => r.text ?? "").join("");
        }
        if (o.result !== undefined && o.result !== null)
            return String(o.result);
    }
    return "";
}
function cellNumber(cell) {
    const text = cellText(cell).trim();
    if (text === "")
        return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}
// =============================================================
// Excel yaratish (shablon / eksport)
// =============================================================
async function generateTestExcel(data) {
    const wb = new exceljs_1.default.Workbook();
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
            .filter((v) => v !== null)
            .join(",");
        ws.addRow([idx + 1, q.question_text, q.question_type, q.points, ...optionTexts, correct]);
    });
    // Ustun kengliklari (ko'rinish uchun)
    ws.getColumn(2).width = 45;
    ws.getColumn(3).width = 14;
    // ExcelJS writeBuffer() ish vaqtida Node Buffer qaytaradi; @types/node generic
    // `Buffer` nuancelaridan saqlanish uchun cast qilamiz (asl xulq-atvor saqlanadi).
    const buf = await wb.xlsx.writeBuffer();
    return buf;
}
// =============================================================
// Excel'ni o'qish (import)
// =============================================================
async function parseTestExcel(buffer) {
    const wb = new exceljs_1.default.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws)
        throw new Error("Excel faylida varaq topilmadi");
    let title = "";
    let description = null;
    let timeLimit = null;
    let maxAttempts = null;
    let testType = "home_study";
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
        }
        else if (label.startsWith("tavsif")) {
            const t = cellText(value).trim();
            description = t === "" ? null : t;
        }
        else if (label.startsWith("vaqt")) {
            timeLimit = cellNumber(value);
        }
        else if (label.startsWith("test turi")) {
            const t = norm(cellText(value));
            if (TEST_TYPES.includes(t))
                testType = t;
        }
        else if (label.startsWith("urinish")) {
            maxAttempts = cellNumber(value);
        }
    }
    if (headerRowNum < 0)
        throw new Error("Savollar jadvali sarlavhasi topilmadi");
    if (title === "")
        throw new Error("Test sarlavhasi (Sarlavha) kiritilmagan");
    // Ustun joylashuvini sarlavha qatoridan aniqlash
    let textCol = 2;
    let typeCol = 3;
    let pointsCol = 4;
    let correctCol = -1;
    const optionCols = [];
    ws.getRow(headerRowNum).eachCell((cell, colNumber) => {
        const h = norm(cellText(cell));
        if (h === "savol matni")
            textCol = colNumber;
        else if (h.startsWith("savol turi"))
            typeCol = colNumber;
        else if (h === "ball")
            pointsCol = colNumber;
        else if (h.startsWith("variant"))
            optionCols.push(colNumber);
        else if (h.startsWith("togri"))
            correctCol = colNumber;
    });
    optionCols.sort((a, b) => a - b);
    const questions = [];
    for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const questionText = cellText(row.getCell(textCol)).trim();
        if (questionText === "")
            continue; // bo'sh qatorlarni o'tkazib yuborish
        const rawType = norm(cellText(row.getCell(typeCol)));
        const questionType = QUESTION_TYPES.includes(rawType)
            ? rawType
            : "single";
        const points = cellNumber(row.getCell(pointsCol)) ?? 1;
        const correctRaw = correctCol > 0 ? cellText(row.getCell(correctCol)) : "";
        const correctIndexes = new Set(correctRaw
            .split(/[,\s;]+/)
            .map((s) => parseInt(s, 10))
            .filter((n) => !Number.isNaN(n)));
        const options = [];
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
    if (questions.length === 0)
        throw new Error("Faylda birorta savol topilmadi");
    return {
        title,
        description,
        time_limit: timeLimit,
        test_type: testType,
        max_attempts: maxAttempts,
        questions,
    };
const TEST_TYPES = {
    "Kirish": "entry",
    "Mavzu so'nggi": "post_topic",
    "Mustaqil ta'lim": "home_study",
};
const TEST_TYPES_REV = {
    entry: "Kirish",
    post_topic: "Mavzu so'nggi",
    home_study: "Mustaqil ta'lim",
};
const Q_TYPES = {
    "Bir javobli": "single",
    "Ko'p javobli": "multiple",
    "To'g'ri/Noto'g'ri": "true_false",
    "Ochiq javob": "fill_blank",
};
const Q_TYPES_REV = {
    single: "Bir javobli",
    multiple: "Ko'p javobli",
    true_false: "To'g'ri/Noto'g'ri",
    fill_blank: "Ochiq javob",
};
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
const SUBHEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
const WHITE_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
const DARK_FONT = { bold: true, color: { argb: "FF1F3864" }, size: 11 };
const BORDER = {
    top: { style: "thin" }, left: { style: "thin" },
    bottom: { style: "thin" }, right: { style: "thin" },
};
async function generateTestExcel(test) {
    const wb = new exceljs_1.default.Workbook();
    wb.creator = "I-Imkon.uz";
    // ── Sheet 1: Test ma'lumotlari ──────────────────────────────────────────────
    const s1 = wb.addWorksheet("Test ma'lumotlari");
    s1.columns = [
        { key: "key", width: 30 },
        { key: "val", width: 50 },
    ];
    const addInfoRow = (key, val, isHeader = false) => {
        const row = s1.addRow([key, val ?? ""]);
        if (isHeader) {
            row.getCell(1).fill = HEADER_FILL;
            row.getCell(1).font = WHITE_FONT;
            row.getCell(2).fill = HEADER_FILL;
            row.getCell(2).font = WHITE_FONT;
        }
        else {
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
        { key: "num", width: 5, header: "№" },
        { key: "q", width: 50, header: "Savol matni *" },
        { key: "type", width: 20, header: "Tur *" },
        { key: "points", width: 8, header: "Ball" },
        { key: "a", width: 25, header: "A" },
        { key: "b", width: 25, header: "B" },
        { key: "c", width: 25, header: "C" },
        { key: "d", width: 25, header: "D" },
        { key: "ans", width: 30, header: "To'g'ri javob *" },
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
        }
        else if (q.question_type === "multiple") {
            answerText = opts
                .map((o, j) => (o.is_correct ? ["A", "B", "C", "D"][j] : null))
                .filter(Boolean)
                .join(",");
        }
        else if (q.question_type === "true_false") {
            answerText = opts[0]?.is_correct ? "To'g'ri" : "Noto'g'ri";
        }
        else {
            answerText = opts[0]?.option_text ?? "";
        }
        const row = s2.addRow({
            num: i + 1,
            q: q.question_text,
            type: Q_TYPES_REV[q.question_type],
            points: q.points,
            a: opts[0]?.option_text ?? "",
            b: opts[1]?.option_text ?? "",
            c: opts[2]?.option_text ?? "",
            d: opts[3]?.option_text ?? "",
            ans: answerText,
        });
        row.eachCell((cell) => {
            cell.border = BORDER;
            cell.alignment = { vertical: "middle", wrapText: true };
        });
        row.height = 20;
        const fill = i % 2 === 0
            ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FBFF" } }
            : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
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
async function parseTestExcel(buffer) {
    const wb = new exceljs_1.default.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer);
    const s1 = wb.getWorksheet("Test ma'lumotlari") ?? wb.worksheets[0];
    const s2 = wb.getWorksheet("Savollar") ?? wb.worksheets[1];
    if (!s1 || !s2)
        throw new Error("Excel formati noto'g'ri: ikkita sheet kerak");
    const getCell = (row, col) => String(s1.getRow(row).getCell(col).value ?? "").trim();
    const title = getCell(2, 2);
    const desc = getCell(3, 2) || null;
    const timeStr = getCell(4, 2);
    const testTypeRaw = getCell(5, 2);
    const maxAttemptStr = getCell(6, 2);
    if (!title)
        throw new Error("Sarlavha bo'sh bo'lmasligi kerak");
    const test_type = TEST_TYPES[testTypeRaw] ?? "home_study";
    const time_limit = timeStr ? parseInt(timeStr) || null : null;
    const max_attempts = maxAttemptStr ? parseInt(maxAttemptStr) || null : null;
    const questions = [];
    s2.eachRow((row, rowNum) => {
        if (rowNum === 1)
            return; // header
        const getVal = (col) => String(row.getCell(col).value ?? "").trim();
        const questionText = getVal(2);
        const typeVal = getVal(3);
        if (!questionText || !typeVal || !(typeVal in Q_TYPES))
            return;
        const typeRaw = getVal(3);
        const question_type = Q_TYPES[typeRaw] ?? "single";
        const points = parseInt(getVal(4)) || 1;
        const a = getVal(5), b = getVal(6), c = getVal(7), d = getVal(8);
        const answerRaw = getVal(9).trim();
        let options = [];
        if (question_type === "true_false") {
            const correct = answerRaw === "To'g'ri";
            options = [
                { option_text: "To'g'ri", is_correct: correct },
                { option_text: "Noto'g'ri", is_correct: !correct },
            ];
        }
        else if (question_type === "fill_blank") {
            options = [{ option_text: answerRaw, is_correct: true }];
        }
        else if (question_type === "multiple") {
            const correctLetters = answerRaw.toUpperCase().split(",").map((s) => s.trim());
            const letters = ["A", "B", "C", "D"];
            [a, b, c, d].forEach((text, i) => {
                if (text)
                    options.push({ option_text: text, is_correct: correctLetters.includes(letters[i]) });
            });
        }
        else {
            const correctLetter = answerRaw.toUpperCase().trim();
            const letters = ["A", "B", "C", "D"];
            [a, b, c, d].forEach((text, i) => {
                if (text)
                    options.push({ option_text: text, is_correct: letters[i] === correctLetter });
            });
        }
        questions.push({ question_text: questionText, question_type, points, options });
    });
    if (questions.length === 0)
        throw new Error("Hech qanday savol topilmadi");
    return { title, description: desc, time_limit, test_type, max_attempts, questions };
}
