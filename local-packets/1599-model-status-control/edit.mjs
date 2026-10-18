import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import process from 'node:process';

const input = process.argv[2];
const output = process.argv[3];
const mode = process.argv[4] ?? 'inspect';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
await fs.mkdir(output, { recursive: true });
for (const [sheet, range] of [['Checks', 'A16:G21'], ['Key', 'B60:F64'], ['Assumptions', 'A32:D34']]) {
  const result = await workbook.inspect({ kind: 'region', sheetId: sheet, range,
    include: 'values,formulas', maxChars: 2200, tableMaxRows: 6, tableMaxCols: 7 });
  process.stdout.write(result.ndjson + '\n');
}
if (mode === 'edit') {
  workbook.worksheets.getItem('Checks').getRange('A18').formulas = [[
    '=IF(AND(COUNTIF(F5:F15,"OK")=ROWS(F5:F15),COUNTIF(F20:F35,"OK")=ROWS(F20:F35)),"MODEL STATUS: PASS","MODEL STATUS: FAIL")',
  ]];
  workbook.recalculate();
  const file = await SpreadsheetFile.exportXlsx(workbook);
  await file.save(`${output}/candidate.xlsx`);
  process.stdout.write((await workbook.inspect({ kind: 'region', sheetId: 'Checks', range: 'A18:F18', maxChars: 1200 })).ndjson + '\n');
}
for (const [sheet, range] of [['Checks', 'A16:G21'], ['Key', 'B60:F64']]) {
  const preview = await workbook.render({ sheetName: sheet, range, scale: 1.5, format: 'png' });
  await fs.writeFile(`${output}/${sheet}-${mode}.png`, new Uint8Array(await preview.arrayBuffer()));
}
