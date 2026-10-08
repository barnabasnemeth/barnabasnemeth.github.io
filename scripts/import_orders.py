#!/usr/bin/env python3
"""Build a local SQL import for historical orders.

Reads the rendelesek sheet from a Google Sheet .xlsx export and writes SQL
plus a report. The output contains customer data. It is gitignored and must
not be committed.

Example:
  py -3 scripts/import_orders.py --xlsx "C:\\Users\\KomPhone\\Downloads\\Cremes Weblap.xlsx"
"""

import argparse
import json
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "supabase" / "imports"


def fold(value):
    text = unicodedata.normalize("NFD", str(value or "").strip().lower())
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def col_index(cell_ref):
    letters = re.match(r"([A-Z]+)", cell_ref).group(1)
    number = 0
    for ch in letters:
        number = number * 26 + ord(ch) - 64
    return number


def load_sheet_rows(path, sheet_name):
    with zipfile.ZipFile(path) as workbook:
        shared = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            for item in root.findall("m:si", NS):
                shared.append("".join(node.text or "" for node in item.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")))
        book = ET.fromstring(workbook.read("xl/workbook.xml"))
        rels = ET.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        sheet_path = None
        for sheet in book.findall("m:sheets/m:sheet", NS):
            if sheet.attrib.get("name") == sheet_name:
                rel_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
                target = targets[rel_id]
                sheet_path = "xl/" + target if not target.startswith("xl/") else target
                break
        if not sheet_path:
            raise SystemExit(f"Sheet not found: {sheet_name}")
        root = ET.fromstring(workbook.read(sheet_path))
        rows = {}
        for cell in root.findall(".//m:c", NS):
            ref = cell.attrib.get("r")
            if not ref:
                continue
            match = re.match(r"([A-Z]+)(\d+)", ref)
            column, row_number = match.group(1), int(match.group(2))
            value_node = cell.find("m:v", NS)
            kind = cell.attrib.get("t")
            if kind == "s" and value_node is not None and value_node.text:
                value = shared[int(value_node.text)]
            elif kind == "inlineStr":
                value = "".join(node.text or "" for node in cell.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"))
            elif value_node is not None and value_node.text:
                value = value_node.text
            else:
                value = ""
            rows.setdefault(row_number, {})[column] = value
    if not rows:
        return []
    header_row = min(rows)
    header = {col_index(col): str(rows[header_row][col]).strip() for col in rows[header_row]}
    records = []
    for row_number in sorted(rows):
        if row_number == header_row:
            continue
        record = {"__row": row_number}
        for column, name in header.items():
            letters = ""
            index = column
            while index:
                index, rem = divmod(index - 1, 26)
                letters = chr(65 + rem) + letters
            record[name] = rows[row_number].get(letters, "")
        records.append(record)
    return records


def excel_datetime(value):
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip()
    if re.fullmatch(r"-?\d+(\.\d+)?", text):
        serial = float(text)
        if serial > 20000:
            base = datetime(1899, 12, 30) + timedelta(days=serial)
            return base.replace(microsecond=0)
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:19] if "T" in fmt or ":" in fmt else text[:10], fmt)
        except ValueError:
            continue
    return None


def sql_literal(value):
    if value is None:
        return "null"
    text = str(value)
    tag = "imp"
    while f"${tag}$" in text:
        tag += "x"
    return f"${tag}${text}${tag}$"


def sql_int(value):
    if value is None or str(value).strip() == "":
        return "null"
    digits = re.sub(r"[^\d-]", "", str(value).split(".")[0])
    if digits in ("", "-"):
        return "null"
    return str(int(digits))


def sql_bool(value):
    return "true" if fold(value) == "igen" else "false"


def sql_timestamp(value):
    parsed = excel_datetime(value)
    if not parsed:
        return None
    return f"(timestamp '{parsed.strftime('%Y-%m-%d %H:%M:%S')}' at time zone 'Europe/Budapest')"


def sql_date(value):
    parsed = excel_datetime(value)
    if not parsed:
        return None
    return f"date '{parsed.strftime('%Y-%m-%d')}'"


def phone_text(value):
    text = str(value or "").strip()
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".")[0]
    if re.fullmatch(r"\d+(\.\d+)?", text):
        number = float(text)
        if number.is_integer():
            return str(int(number))
    return text


def canonical_status(value, warnings, row_number):
    key = fold(value)
    mapping = {
        "uj": "Új",
        "": "Új",
        "folyamatban": "Folyamatban",
        "elkeszult": "Elkészült",
        "atveve": "Átvéve",
    }
    if key in mapping:
        if key == "" and str(value or "").strip() == "":
            warnings.append(f"row {row_number}: empty status stored as Új")
        return mapping[key]
    warnings.append(f"row {row_number}: unknown status {value!r} stored as Új and kept in the note")
    return "Új"


def parse_items(cake_text, slice_text, warnings, row_number):
    names = [part.strip() for part in str(cake_text or "").split(";") if part.strip()]
    slices = [part.strip() for part in str(slice_text or "").split(";")]
    items = []
    if not names and str(cake_text or "").strip():
        warnings.append(f"row {row_number}: cake text could not be split; stored as one line")
        names = [str(cake_text).strip()]
    for index, name in enumerate(names):
        qty_match = re.search(r"x\s*(\d+)\s*db", name, re.I)
        quantity = int(qty_match.group(1)) if qty_match else 1
        clean_name = re.sub(r"\s*x\s*\d+\s*db\s*$", "", name, flags=re.I).strip() or name
        slice_value = slices[index].strip() if index < len(slices) else ""
        slice_number = None
        if slice_value:
            if re.fullmatch(r"\d+(\.0+)?", slice_value):
                slice_number = int(float(slice_value))
            else:
                digits = re.sub(r"[^\d]", "", slice_value)
                slice_number = int(digits) if digits else None
            if slice_number is None:
                warnings.append(f"row {row_number}: slice value was not numeric")
            elif slice_number <= 0 or slice_number > 200:
                warnings.append(f"row {row_number}: slice {slice_number} is outside 1..200; stored without a slice")
                slice_number = None
            elif slice_number not in (8, 12, 16, 24):
                warnings.append(f"row {row_number}: nonstandard slice {slice_number} kept on the historical line")
        if quantity < 1 or quantity > 50:
            warnings.append(f"row {row_number}: quantity {quantity} clamped to 1..50")
            quantity = min(50, max(1, quantity))
        items.append((clean_name[:160], slice_number, quantity))
    if len(slices) > len(names) and any(part.strip() for part in slices[len(names):]):
        warnings.append(f"row {row_number}: more slice values than cake names")
    return items


def parse_invoice(raw, warnings, row_number):
    text = str(raw or "").strip()
    if not text:
        return None, None, None, ""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        warnings.append(f"row {row_number}: invoice JSON was not valid; raw text appended to the note")
        return None, None, None, "\n[afas_szamla_adatok] " + text
    if not isinstance(data, dict):
        warnings.append(f"row {row_number}: invoice JSON was not an object; raw text appended to the note")
        return None, None, None, "\n[afas_szamla_adatok] " + text
    return (
        str(data.get("cegnev") or "")[:300] or None,
        str(data.get("cim") or "")[:300] or None,
        str(data.get("adoszam") or "")[:32] or None,
        "",
    )


def parsed_order_number(record):
    raw = str(record.get("sorszam") or "").strip()
    if not re.fullmatch(r"\d+(\.0+)?", raw):
        return None
    return int(float(raw))


# Earlier sheet row of a known getLastRow() collision only.
# The later row keeps the original sorszam. 10000 keeps these out of the
# production sequence, whose next value stays max(normal number)+1.
EARLIER_COLLISION_NUMBERS = {
    15: 10015,
    16: 10016,
    17: 10017,
    18: 10018,
    19: 10019,
    20: 10020,
    21: 10021,
    22: 10022,
    26: 10026,
}


def importable_order_groups(records):
    groups = {}
    for record in records:
        number = parsed_order_number(record)
        if number is None or not excel_datetime(record.get("atvetel_napja")):
            continue
        groups.setdefault(number, []).append(record)
    for number in groups:
        groups[number].sort(key=lambda record: record["__row"])
    return groups


def plan_order_numbers(records):
    """Map sheet row -> order_number.

    A repeated sorszam is renumbered only on its earliest sheet row, and only
    when that original number is one of the known legacy collisions.
    """
    by_row = {}
    renumbered = []
    unresolved = {}
    for number, group in importable_order_groups(records).items():
        if len(group) == 1:
            by_row[group[0]["__row"]] = number
            continue
        mapped = EARLIER_COLLISION_NUMBERS.get(number)
        if mapped is None or len(group) != 2:
            unresolved[number] = group
            continue
        earlier = group[0]
        by_row[earlier["__row"]] = mapped
        by_row[group[1]["__row"]] = number
        renumbered.append({
            "sheet_row": earlier["__row"],
            "original_order_number": number,
            "migrated_order_number": mapped,
        })
    finals = list(by_row.values())
    if len(finals) != len(set(finals)):
        row_record = {
            record["__row"]: record
            for group in importable_order_groups(records).values()
            for record in group
        }
        seen = {}
        for row_number, final in by_row.items():
            seen.setdefault(final, []).append(row_record[row_number])
        for final, rows in seen.items():
            if len(rows) > 1:
                unresolved[final] = rows
    renumbered.sort(key=lambda item: item["sheet_row"])
    return by_row, renumbered, unresolved


def describe_duplicate_group(number, group):
    compare_fields = (
        "nev", "email", "telefonszám", "rendeles_ideje", "atvetel_napja",
        "atvetel_intervallum", "torta_tipusa", "szeletek_szama", "vegosszeg_HUF", "megjegyzes",
    )
    lines = [f"order_number {number} appears {len(group)} times in rendelesek:"]
    snapshots = []
    for record in group:
        ordered = excel_datetime(record.get("rendeles_ideje"))
        pickup = excel_datetime(record.get("atvetel_napja"))
        snapshot = {field: str(record.get(field) or "") for field in compare_fields}
        snapshots.append(snapshot)
        lines.append(
            f"  sheet row {record['__row']}: raw sorszam {str(record.get('sorszam') or '').strip()!r}, "
            f"ordered {ordered}, pickup {pickup.date() if pickup else None}, "
            f"slot {str(record.get('atvetel_intervallum') or '').strip()!r}"
        )
    identical = all(item == snapshots[0] for item in snapshots[1:])
    if identical:
        lines.append("  classification: identical source rows")
    else:
        lines.append("  classification: different orders; the rows are not copies of each other")
    return lines, identical


def write_report(out_path, imported, skipped, warnings, renumbered, assigned, sql_written):
    normal_numbers = [number for number in assigned if number < 10000]
    unique = len(assigned) == len(set(assigned))
    lines = [
        f"imported_orders={imported}",
        f"skipped_rows={len(skipped)}",
        f"warnings={len(warnings)}",
        f"renumbered_rows={len(renumbered)}",
        f"normal_order_min={min(normal_numbers) if normal_numbers else ''}",
        f"normal_order_max={max(normal_numbers) if normal_numbers else ''}",
        f"next_order_number={(max(normal_numbers) + 1) if normal_numbers else ''}",
        f"order_numbers_unique={'yes' if unique else 'no'}",
        f"sql_written={'yes' if sql_written else 'no'}",
        "",
        "Renumbered earlier collision rows:",
    ]
    if renumbered:
        for item in renumbered:
            lines.append(
                f"sheet row {item['sheet_row']}: original {item['original_order_number']} "
                f"-> migrated {item['migrated_order_number']}"
            )
    else:
        lines.append("(none)")
    lines.extend(["", "Warnings:", *(warnings or ["(none)"])])
    report_path = out_path.with_suffix(".report.txt")
    skipped_path = out_path.with_suffix(".skipped.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    skipped_path.write_text(json.dumps(skipped, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return report_path, skipped_path


def refuse_duplicate_order_numbers(groups, out_path):
    report_path = out_path.with_suffix(".report.txt")
    skipped_path = out_path.with_suffix(".skipped.json")
    lines = [
        "imported_orders=0",
        "skipped_rows=0",
        f"duplicate_order_numbers={len(groups)}",
        f"duplicate_rows={sum(len(rows) for rows in groups.values())}",
        "sql_written=no",
        "",
        "Unresolved duplicate sorszam values in the source sheet.",
        "orders_import.sql was not written.",
        "No order was discarded and no historical number was changed.",
        "",
    ]
    payload = []
    for number in sorted(groups):
        description, identical = describe_duplicate_group(number, groups[number])
        lines.extend(description)
        lines.append("")
        payload.append({
            "order_number": number,
            "identical_rows": identical,
            "sheet_rows": [record["__row"] for record in groups[number]],
            "records": groups[number],
        })
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    skipped_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    if out_path.exists():
        out_path.unlink()
    print(f"Wrote {report_path}")
    print(f"Wrote {skipped_path}")
    print("Did not write orders_import.sql.")
    print(
        f"Unresolved duplicate order numbers: {len(groups)} "
        f"({sum(len(rows) for rows in groups.values())} sheet rows)."
    )
    raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", required=True, help="Path to the Sheet export. Do not commit this file.")
    parser.add_argument("--out", default=str(OUT_DIR / "orders_import.sql"))
    args = parser.parse_args()
    source = Path(args.xlsx)
    if not source.exists():
        raise SystemExit(f"File not found: {source}")

    records = load_sheet_rows(source, "rendelesek")
    out_path = Path(args.out)
    by_row, renumbered, unresolved = plan_order_numbers(records)
    if unresolved:
        refuse_duplicate_order_numbers(unresolved, out_path)

    statements = [
        "-- Local historical order import. Contains customer data. Do not commit.",
        "begin;",
    ]
    warnings = []
    skipped = []
    imported = 0
    assigned = []

    for record in records:
        row_number = record["__row"]
        order_number_raw = str(record.get("sorszam") or "").strip()
        if not re.fullmatch(r"\d+(\.0+)?", order_number_raw):
            skipped.append({"sheet_row": row_number, "reason": "missing or invalid sorszam", "record": {k: v for k, v in record.items()}})
            warnings.append(f"row {row_number}: skipped, missing sorszam")
            continue
        original_order_number = int(float(order_number_raw))
        pickup_dt = excel_datetime(record.get("atvetel_napja"))
        ordered_dt = excel_datetime(record.get("rendeles_ideje"))
        if not pickup_dt:
            skipped.append({"sheet_row": row_number, "order_number": original_order_number, "reason": "missing pickup date", "record": record})
            warnings.append(f"row {row_number}: skipped order {original_order_number}, missing pickup date")
            continue
        order_number = by_row[row_number]
        if not ordered_dt:
            warnings.append(f"row {row_number}: order {original_order_number} had no order time; pickup date at 12:00 Europe/Budapest was used")
            ordered_at = f"(timestamp '{pickup_dt.strftime('%Y-%m-%d')} 12:00:00' at time zone 'Europe/Budapest')"
        else:
            ordered_at = f"(timestamp '{ordered_dt.strftime('%Y-%m-%d %H:%M:%S')}' at time zone 'Europe/Budapest')"
        pickup = f"date '{pickup_dt.strftime('%Y-%m-%d')}'"
        status = canonical_status(record.get("statusz"), warnings, row_number)
        company, address, tax, invoice_note = parse_invoice(record.get("afas_szamla_adatok"), warnings, row_number)
        note = str(record.get("megjegyzes") or "")
        original_status = str(record.get("statusz") or "").strip()
        if fold(original_status) not in ("", "uj", "folyamatban", "elkeszult", "atveve"):
            note += f"\n[eredeti statusz] {original_status}"
        note += invoice_note
        if len(note) > 20000:
            warnings.append(f"row {row_number}: note truncated to 20000 characters")
            note = note[:20000]
        name = str(record.get("nev") or "").strip() or "Ismeretlen"
        email = str(record.get("email") or "").strip() or "missing@invalid.local"
        if email == "missing@invalid.local" or len(name) > 120:
            warnings.append(f"row {row_number}: name or email needed a fallback so the row could be kept")
        phone = phone_text(record.get("telefonszám") or record.get("telefonszam") or "")
        if len(phone) < 8:
            phone = (phone + "00000000")[:8]
            warnings.append(f"row {row_number}: phone was shorter than the database minimum and was padded")
        items = parse_items(record.get("torta_tipusa"), record.get("szeletek_szama"), warnings, row_number)
        cake_total_sql = sql_int(record.get("torta_ossz_HUF"))
        if not items:
            warnings.append(f"row {row_number}: order {original_order_number} has no cake lines; order totals were still kept")
        paid_raw = str(record.get("fizetve") or "").strip()
        if paid_raw and fold(paid_raw) not in ("igen", "nem"):
            warnings.append(f"row {row_number}: unexpected fizetve value {paid_raw!r} stored as nem")

        statements.append(
            "insert into public.orders ("
            "order_number, customer_name, email, phone, ordered_at, pickup_date, pickup_slot, note, allergy_note, "
            "status, paid, is_rush, rush_surcharge_huf, cake_total_huf, candle_total_huf, firework_total_huf, "
            "box_total_huf, known_subtotal_huf, grand_total_huf, candle_requested, candle_text, firework_requested, "
            "box_requested, haccp_requested, invoice_requested, invoice_company, invoice_address, invoice_tax_id"
            ") values ("
            f"{order_number}, {sql_literal(name[:120])}, {sql_literal(email[:320])}, {sql_literal(phone[:40])}, "
            f"{ordered_at}, {pickup}, {sql_literal(str(record.get('atvetel_intervallum') or 'nincs')[:40])}, "
            f"{sql_literal(note)}, {sql_literal(str(record.get('allergia_erzekenyseg') or '')[:2000])}, "
            f"{sql_literal(status)}, {sql_bool(paid_raw)}, {sql_bool(record.get('rovid_hataridos'))}, "
            f"{sql_int(record.get('rovid_hataridos_felar_HUF'))}, {cake_total_sql}, "
            f"{sql_int(record.get('szamgyertya_ossz_HUF'))}, {sql_int(record.get('tuzijatek_ossz_HUF'))}, "
            f"{sql_int(record.get('tortadoboz_ossz_HUF'))}, {sql_int(record.get('reszosszeg_ismertek_HUF'))}, "
            f"{sql_int(record.get('vegosszeg_HUF'))}, {sql_bool(record.get('szamgyertya'))}, "
            f"{sql_literal(str(record.get('szamgyertya_tipus') or '')[:32])}, {sql_bool(record.get('tuzijatek'))}, "
            f"{sql_bool(record.get('tortadoboz'))}, {sql_bool(record.get('haccp'))}, {sql_bool(record.get('afas_szamla'))}, "
            f"{sql_literal(company) if company else 'null'}, {sql_literal(address) if address else 'null'}, "
            f"{sql_literal(tax) if tax else 'null'}"
            ");"
        )
        for index, (item_name, slices, quantity) in enumerate(items, start=1):
            slice_sql = "null" if slices is None else str(slices)
            if len(items) == 1 and cake_total_sql != "null":
                line_sql = cake_total_sql
                unit_sql = cake_total_sql if quantity == 1 else "null"
            else:
                line_sql = "null"
                unit_sql = "null"
            statements.append(
                "insert into public.order_items ("
                "order_id, product_id, product_name, slices, quantity, unit_price_huf, line_total_huf, sort_order"
                ") "
                f"select id, null, {sql_literal(item_name)}, {slice_sql}, {quantity}, {unit_sql}, {line_sql}, {index} "
                f"from public.orders where order_number = {order_number};"
            )
        imported += 1
        assigned.append(order_number)

    if len(assigned) != len(set(assigned)):
        warnings.append("validation failed: order_number values are not unique; SQL was not written")
        write_report(out_path, imported, skipped, warnings, renumbered, assigned, sql_written=False)
        if out_path.exists():
            out_path.unlink()
        raise SystemExit("order_number values are not unique; orders_import.sql was not written")

    normal_numbers = [number for number in assigned if number < 10000]
    next_normal = (max(normal_numbers) + 1) if normal_numbers else 1
    statements.append(
        "-- Legacy 10000-prefix order numbers stay out of this sequence.\n"
        f"-- The next nextval() is {next_normal}.\n"
        f"select setval('public.order_number_seq', {next_normal - 1}, true);"
    )
    statements.append("commit;")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(statements) + "\n", encoding="utf-8")
    report_path, skipped_path = write_report(
        out_path, imported, skipped, warnings, renumbered, assigned, sql_written=True
    )
    normal_numbers = [number for number in assigned if number < 10000]
    print(f"Wrote {out_path}")
    print(f"Wrote {report_path}")
    print(f"Wrote {skipped_path}")
    print(f"imported_orders={imported}")
    print(f"skipped_rows={len(skipped)}")
    print(f"warnings={len(warnings)}")
    print(f"renumbered_rows={len(renumbered)}")
    print(f"normal_order_min={min(normal_numbers)}")
    print(f"normal_order_max={max(normal_numbers)}")
    print(f"next_order_number={max(normal_numbers) + 1}")
    print("order_numbers_unique=yes")
    print("These files contain customer data. Do not commit them.")


if __name__ == "__main__":
    main()
