"""Read-only native recalculation results, never an authoring path."""
import json
import sys
import openpyxl

book = openpyxl.load_workbook(sys.argv[1], data_only=True)
formulas = openpyxl.load_workbook(sys.argv[1], data_only=False)
values = {f'{sheet.title}!{cell.coordinate}': cell.value for sheet in book for row in sheet for cell in row if cell.value is not None}
errors = [key for key, value in values.items() if isinstance(value, str) and value.startswith(('#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A', '#NUM!', '#NULL!', '#SPILL!', '#CALC!'))]
print(json.dumps({'values': values, 'errors': errors, 'formulaCount': sum(cell.data_type == 'f' for sheet in formulas for row in sheet for cell in row)}, default=str))
