#!/usr/bin/env python3
"""
Generate 20260611000011_licensed_bakeries_table.sql from two CSV files.
"""

import csv
import re
import uuid

# ── paths ──────────────────────────────────────────────────────────────────────
HAMILTON_CSV  = "/Users/newuser/Desktop/hamilton_bakeries_with_coordinates.csv"
TORONTO_CSV   = "/Users/newuser/Desktop/toronto_bakeries_with_coordinates.csv"
OUTPUT_SQL    = (
    "/Users/newuser/Desktop/Dianas app/Bakerly/supabase/migrations/"
    "20260611000011_licensed_bakeries_table.sql"
)

# ── helpers ────────────────────────────────────────────────────────────────────
HAMILTON_CITIES = {
    "hamilton", "flamborough", "ancaster", "stoney creek", "dundas", "glanbrook",
}

def clean_address(raw: str, city: str) -> str:
    """Strip postal codes, province tags, city names, tidy whitespace, title-case."""
    s = raw.strip()
    # Remove postal code (e.g. "L8V 2W9")
    s = re.sub(r'\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b', '', s, flags=re.IGNORECASE)
    # Remove " ON" (province) and everything after it (catches "ON L8S…" too)
    s = re.sub(r'\s+ON\b.*$', '', s, flags=re.IGNORECASE)
    # For Hamilton rows: strip trailing city names
    if city == "Hamilton":
        pattern = r',?\s+(' + '|'.join(HAMILTON_CITIES) + r')\s*$'
        s = re.sub(pattern, '', s, flags=re.IGNORECASE)
    # Collapse double spaces
    s = re.sub(r'  +', ' ', s).strip()
    # Remove trailing comma
    s = s.rstrip(',').strip()
    return s.title()


def extract_hamilton_name(raw: str) -> str:
    """Return the part after 'O/A', title-cased. Return empty string if absent."""
    if 'O/A' in raw.upper():
        idx = raw.upper().index('O/A')
        name = raw[idx + 3:].strip().rstrip('.')
        return name.title()
    # No O/A — use the whole thing title-cased (fallback)
    return raw.strip().title()


def normalise_key(name: str) -> str:
    """Normalise name for deduplication."""
    s = name.lower()
    s = s.replace('&', 'and')
    s = re.sub(r'[^a-z0-9 ]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def make_uuid(source_id: str, city: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{source_id}:{city}"))


def sql_str(s: str) -> str:
    """Wrap in single quotes, doubling any internal single quotes."""
    return "'" + s.replace("'", "''") + "'"


def sql_float(s: str):
    """Return a float literal or NULL."""
    try:
        v = float(s)
        return str(v)
    except (ValueError, TypeError):
        return "NULL"


# ── load Hamilton ──────────────────────────────────────────────────────────────
def load_hamilton():
    rows = []
    with open(HAMILTON_CSV, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw_name = row['BUSINESS_NAME'].strip()
            name = extract_hamilton_name(raw_name)
            if not name:
                continue

            source_id = f"ham-{row['OBJECTID'].strip()}"
            address = clean_address(row['BUSINESS_ADDRESS'], "Hamilton")
            lat_raw = row['latitude'].strip()
            lng_raw = row['longitude'].strip()

            rows.append({
                'source_id': source_id,
                'name': name,
                'address': address,
                'city': 'Hamilton',
                'lat': lat_raw,
                'lng': lng_raw,
                'norm_key': normalise_key(name),
            })
    return rows


# ── load Toronto ───────────────────────────────────────────────────────────────
def load_toronto():
    rows = []
    with open(TORONTO_CSV, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw_name = row['Operating Name'].strip()
            if not raw_name:
                continue
            name = raw_name.title()

            source_id = f"tor-{row['_id'].strip()}"
            # Build address from Line 1 only (Line 2 is "TORONTO, ON"; Line 3 is postal)
            addr_raw = row['Licence Address Line 1'].strip()
            address = clean_address(addr_raw, "Toronto")

            lat_raw = row['latitude'].strip()
            lng_raw = row['longitude'].strip()

            rows.append({
                'source_id': source_id,
                'name': name,
                'address': address,
                'city': 'Toronto',
                'lat': lat_raw,
                'lng': lng_raw,
                'norm_key': normalise_key(name),
            })
    return rows


# ── deduplicate ────────────────────────────────────────────────────────────────
def deduplicate(rows):
    """
    For each (norm_key, city) group keep:
      - the entry that has coordinates if any do;
      - otherwise the first entry.
    Also assign deterministic UUIDs.
    """
    groups: dict[tuple, list] = {}
    for r in rows:
        key = (r['norm_key'], r['city'])
        groups.setdefault(key, []).append(r)

    result = []
    for group in groups.values():
        # Prefer rows that have coordinates
        with_coords = [r for r in group if r['lat'] and r['lng']]
        chosen = with_coords[0] if with_coords else group[0]
        chosen['id'] = make_uuid(chosen['source_id'], chosen['city'])
        result.append(chosen)

    return result


# ── SQL building blocks ────────────────────────────────────────────────────────
DDL = """\
-- ============================================================
-- 20260611000011 · Licensed bakeries directory + claims table
-- ============================================================

-- 1. Licensed bakeries table
CREATE TABLE IF NOT EXISTS public.licensed_bakeries (
  id        UUID             PRIMARY KEY,
  name      TEXT             NOT NULL,
  address   TEXT             NOT NULL DEFAULT '',
  city      TEXT             NOT NULL,
  province  TEXT             NOT NULL DEFAULT 'ON',
  country   TEXT             NOT NULL DEFAULT 'CA',
  lat       DOUBLE PRECISION,
  lng       DOUBLE PRECISION,
  source_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_licensed_bakeries_city ON public.licensed_bakeries (city);
CREATE INDEX IF NOT EXISTS idx_licensed_bakeries_geo  ON public.licensed_bakeries (lat, lng) WHERE lat IS NOT NULL;
ALTER TABLE public.licensed_bakeries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bakeries_select" ON public.licensed_bakeries FOR SELECT USING (true);

-- 2. Drop and recreate directory_claims with UUID FK
DROP TABLE IF EXISTS public.directory_claims;
CREATE TABLE public.directory_claims (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  licensed_bakery_id  UUID        NOT NULL UNIQUE REFERENCES public.licensed_bakeries(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.directory_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claims_select" ON public.directory_claims FOR SELECT USING (true);
CREATE POLICY "claims_insert" ON public.directory_claims FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "claims_update" ON public.directory_claims FOR UPDATE USING (auth.uid() = user_id AND status = 'pending') WITH CHECK (auth.uid() = user_id);

"""


def build_insert(rows, city):
    lines = []
    for r in rows:
        line = (
            f"  ({sql_str(r['id'])}, {sql_str(r['name'])}, {sql_str(r['address'])}, "
            f"{sql_str(r['city'])}, 'ON', 'CA', "
            f"{sql_float(r['lat'])}, {sql_float(r['lng'])}, {sql_str(r['source_id'])})"
        )
        lines.append(line)

    return (
        f"-- 3. Insert {city} rows ({len(rows)} entries)\n"
        "INSERT INTO public.licensed_bakeries "
        "(id, name, address, city, province, country, lat, lng, source_id) VALUES\n"
        + ",\n".join(lines)
        + ";\n"
    )


# ── main ───────────────────────────────────────────────────────────────────────
def main():
    ham_rows = deduplicate(load_hamilton())
    tor_rows = deduplicate(load_toronto())

    # Sort for readability
    ham_rows.sort(key=lambda r: r['name'])
    tor_rows.sort(key=lambda r: r['name'])

    sql = DDL
    sql += build_insert(ham_rows, "Hamilton")
    sql += "\n"
    sql += build_insert(tor_rows, "Toronto")

    with open(OUTPUT_SQL, 'w', encoding='utf-8') as f:
        f.write(sql)

    print(f"Hamilton rows : {len(ham_rows)}")
    print(f"Toronto rows  : {len(tor_rows)}")
    print(f"Total         : {len(ham_rows) + len(tor_rows)}")
    print(f"Written to    : {OUTPUT_SQL}")


if __name__ == '__main__':
    main()
