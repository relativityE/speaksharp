"""Transfer the Artifact Tool-authored formula while preserving all other OOXML.

Artifact import/export normalizes unrelated fonts/fills. Its API has no incremental
package export. This narrow package step preserves the original native features.
"""
import hashlib
from pathlib import Path, PurePosixPath
import re
import sys
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
from zipfile import ZipFile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def sheet_path(book, name):
    sheets = ET.fromstring(book.read('xl/workbook.xml'))
    rid = next(s.attrib[REL] for s in sheets.find('s:sheets', NS) if s.attrib['name'] == name)
    target = next(r.attrib['Target'] for r in ET.fromstring(book.read('xl/_rels/workbook.xml.rels')) if r.attrib['Id'] == rid)
    return target.lstrip('/') if target.startswith('/') else str(PurePosixPath('xl') / target)


original, authored, output = map(Path, sys.argv[1:])
with ZipFile(original) as source, ZipFile(authored) as generated:
    target = sheet_path(source, 'Checks')
    generated_sheet = ET.fromstring(generated.read(sheet_path(generated, 'Checks')))
    formula = generated_sheet.find(".//s:c[@r='A18']/s:f", NS).text
    expected = 'IF(AND(COUNTIF(F5:F15,"OK")=ROWS(F5:F15),COUNTIF(F20:F35,"OK")=ROWS(F20:F35)),"MODEL STATUS: PASS","MODEL STATUS: FAIL")'
    assert formula == expected, 'not the reviewed Artifact Tool formula'
    xml = source.read(target).decode('utf-8')
    cell = re.search(r'<c\b[^>]*\br="A18"[^>]*>[\s\S]*?</c>', xml)
    assert cell, 'original status cell missing'
    replacement, count = re.subn(r'<f(?:\s[^>]*)?>[\s\S]*?</f>', '<f>' + escape(formula) + '</f>', cell.group())
    assert count == 1
    edited = xml[:cell.start()] + replacement + xml[cell.end():]
    with ZipFile(output, 'w') as result:
        for item in source.infolist():
            result.writestr(item, edited.encode('utf-8') if item.filename == target else source.read(item.filename))
with ZipFile(original) as source, ZipFile(output) as final:
    assert source.namelist() == final.namelist()
    changes = [name for name in source.namelist() if source.read(name) != final.read(name)]
    assert changes == [target], changes
print('Preserved original package; only Checks!A18 formula changed. SHA256=' + hashlib.sha256(output.read_bytes()).hexdigest())
