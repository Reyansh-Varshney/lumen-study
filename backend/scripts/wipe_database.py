"""
Wipe the Lumen database and vector store.

Removes every learner and all of their data:
  * accounts and profiles
  * course trackers (subjects / modules / topics)
  * quiz sets and attempts
  * mistake logs and spaced-repetition records
  * activity logs, library chat history, extracted topics and sources
  * every embedded vector chunk in the ChromaDB store

Usage
-----
    python -m scripts.wipe_database                # preview only
    python -m scripts.wipe_database --apply       # wipe (with a backup)
    python -m scripts.wipe_database --apply --no-backup --yes
"""

import argparse
import asyncio
import json
import os
import shutil
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from dotenv import load_dotenv

load_dotenv()

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING

BACKUP_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backups")

# The collections the application expects to exist, with the indexes it relies on.
SCHEMA = {
    "users": [[("email", ASCENDING)]],
    "syllabuses": [[("user_id", ASCENDING)]],
    "srs_records": [
        [("user_id", ASCENDING), ("reference_id", ASCENDING)],
        [("next_review_date", ASCENDING)],
    ],
    "quiz_attempts": [[("user_id", ASCENDING), ("completed_at", DESCENDING)]],
    "quizzes": [],
    "mistake_logs": [],
    "activity_logs": [],
    "source_topics": [],
    "user_topics": [],
    "library_chat_logs": [],
    "resource_sources": [],
}


def jsonable(value):
    """Make a MongoDB document JSON-serialisable."""
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "binary") or type(value).__name__ == "ObjectId":
        return str(value)
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


async def backup(db, target_dir: str) -> int:
    """Dump every collection to JSON so the wipe stays reversible."""
    os.makedirs(target_dir, exist_ok=True)
    total = 0

    for name in sorted(await db.list_collection_names()):
        docs = await db[name].find({}).to_list(length=None)
        path = os.path.join(target_dir, f"{name}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump([jsonable(d) for d in docs], fh, ensure_ascii=False, indent=1)
        total += len(docs)
        print(f"   backed up {name:22s} {len(docs):5d} doc(s)")

    with open(os.path.join(target_dir, "_meta.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "created_at": datetime.now().isoformat(),
            "database": db.name,
            "total_documents": total,
        }, fh, indent=1)

    return total


async def recreate_schema(db):
    """Recreate the empty collections and indexes the app expects."""
    for name, indexes in SCHEMA.items():
        if name not in await db.list_collection_names():
            await db.create_collection(name)
        for keys in indexes:
            await db[name].create_index(keys)
    print(f"   recreated {len(SCHEMA)} collection(s) with their indexes")


def wipe_vector_store(db_dir: str, apply: bool) -> int:
    """Clear the ChromaDB resource collection."""
    try:
        import chromadb
    except ImportError:
        print("   chromadb not installed — skipping the vector store")
        return 0

    client = chromadb.PersistentClient(path=db_dir)
    removed = 0
    for collection in client.list_collections():
        count = collection.count()
        print(f"   vector collection {collection.name:22s} {count:5d} chunk(s)")
        removed += count
        if apply:
            client.delete_collection(collection.name)

    if apply:
        client.get_or_create_collection(
            name="study_resources", metadata={"hnsw:space": "cosine"}
        )
        print("   recreated an empty 'study_resources' collection")
    return removed


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="actually delete the data")
    parser.add_argument("--no-backup", action="store_true", help="skip the JSON backup")
    parser.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    parser.add_argument("--uri", default=os.getenv("MONGO_URI", ""))
    parser.add_argument("--database", default=os.getenv("DATABASE_NAME", "lumen_db"))
    parser.add_argument("--db-dir", default=os.getenv("CHROMA_DB_DIR", "./chroma_db"))
    args = parser.parse_args()

    if not args.uri:
        print("MONGO_URI is not set. Configure it in backend/.env")
        return 1

    apply = args.apply
    mode = "APPLY" if apply else "DRY RUN"
    print(f"Database:  {args.database}")
    print(f"Mode:      {mode}")
    print("=" * 62)

    client = AsyncIOMotorClient(args.uri)
    db = client.get_database(args.database)

    # ── What is there now ───────────────────────────────────────────────────
    collections = sorted(await db.list_collection_names())
    total_docs = 0
    print("\n-- contents --")
    for name in collections:
        count = await db[name].count_documents({})
        total_docs += count
        print(f"   {name:22s} {count:5d} doc(s)")
    user_count = await db.users.count_documents({}) if "users" in collections else 0
    print(f"\n   total: {total_docs} document(s), {user_count} user(s)")

    if not apply:
        print("\n[DRY RUN] nothing was deleted. Re-run with --apply to wipe.")
        client.close()
        return 0

    if not args.yes:
        answer = input(f"\nDelete ALL data in '{args.database}'? [y/N] ").strip().lower()
        if answer not in ("y", "yes"):
            print("Aborted.")
            client.close()
            return 1

    # ── Backup ──────────────────────────────────────────────────────────────
    if not args.no_backup:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        target = os.path.join(BACKUP_ROOT, f"wipe_{stamp}")
        print(f"\n-- backup -> {target} --")
        backed_up = await backup(db, target)
        print(f"   {backed_up} document(s) saved")

    # ── Wipe ────────────────────────────────────────────────────────────────
    print("\n-- dropping collections --")
    for name in collections:
        await db[name].drop()
        print(f"   dropped {name}")

    print("\n-- restoring schema --")
    await recreate_schema(db)

    print("\n-- clearing the vector store --")
    await asyncio.to_thread(wipe_vector_store, args.db_dir, True)

    client.close()

    # ── Verify ──────────────────────────────────────────────────────────────
    client = AsyncIOMotorClient(args.uri)
    db = client.get_database(args.database)
    remaining = {}
    for name in sorted(await db.list_collection_names()):
        remaining[name] = await db[name].count_documents({})
    client.close()

    print("\n-- verification --")
    for name, count in remaining.items():
        print(f"   {name:22s} {count:5d} doc(s)")
    leftover = sum(remaining.values())
    print(f"\n   total remaining: {leftover} document(s)")
    print("WIPE COMPLETE" if leftover == 0 else "WARNING: documents remain")

    return 0 if leftover == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
