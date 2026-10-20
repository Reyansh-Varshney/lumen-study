"""
Recover the ChromaDB metadata rows that were removed when the legacy
`vault_docs` collection was dropped, and re-add them (re-embedded) to the
generic `study_resources` collection.

Why this exists
----------------
The repository ships a pre-populated ChromaDB store containing the documents
a learner uploaded while testing the app. Deleting a ChromaDB collection
removes the rows from the b-tree, but the bytes stay in the file's free
pages. `_sqlite_carver.py` decodes those pages, and this script uses the
result to rebuild the metadata and re-insert the documents.

Usage
-----
    python _recover_vector_store.py <carved_sqlite> <out_json>
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sqlite_carver import iter_records

KEYS = ("doc_id", "doc_name", "page", "user_id", "chroma:document")


def extract(path):
    """Return {embedding_row_id: {key: value}} for every metadata row found.

    NOTE: `embedding_metadata` has PRIMARY KEY (id, key), so the `id` column
    is NOT the b-tree rowid. We must group by the `id` column itself
    (values[0]) to reassemble the five metadata rows of one embedding.
    """
    by_id = defaultdict(dict)
    for pno, rowid, values in iter_records(path):
        if len(values) != 6:
            continue
        key = values[1]
        if key not in KEYS:
            continue
        embedding_id = values[0]
        if embedding_id is None:
            continue
        string_value = values[2]
        int_value = values[3]
        by_id[embedding_id][key] = string_value if string_value is not None else int_value
    return by_id


def normalise(entry):
    """Turn a carved record into the exact shape chroma stores."""
    doc_id = str(entry.get("doc_id") or "").strip()
    doc_name = str(entry.get("doc_name") or "").strip()
    user_id = str(entry.get("user_id") or "").strip()
    document = entry.get("chroma:document")
    page = entry.get("page")
    try:
        page = int(page)
    except (TypeError, ValueError):
        page = 1
    if not doc_id or not doc_name or not document:
        return None
    return {
        "doc_id": doc_id,
        "doc_name": doc_name,
        "user_id": user_id,
        "page": page,
        "document": document,
    }


def main():
    carved_path, out_path = sys.argv[1], sys.argv[2]

    print(f"carving {carved_path} ...")
    carved = extract(carved_path)
    print(f"  {len(carved)} raw row id(s) found")

    # De-duplicate: the same logical chunk can appear several times in the
    # file's history. Key on the content so identical copies collapse.
    unique = {}
    for rowid, entry in carved.items():
        norm = normalise(entry)
        if not norm:
            continue
        fingerprint = (norm["doc_id"], norm["page"], norm["document"])
        unique.setdefault(fingerprint, norm)

    print(f"  {len(unique)} unique chunk(s) after de-duplication")

    by_doc = defaultdict(list)
    for norm in unique.values():
        by_doc[norm["doc_name"]].append(norm)

    for name, chunks in sorted(by_doc.items()):
        pages = sorted({c["page"] for c in chunks})
        print(f"   {name}: {len(chunks)} chunk(s) across {len(pages)} page(s)")

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(list(unique.values()), fh, ensure_ascii=False, indent=1)

    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
