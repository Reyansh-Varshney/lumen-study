"""
Migrate the database from the legacy competitive-exam schema to the generic
Lumen schema.

What it does
------------
1. `users`
   - drops `exam_track` and `exam_date`
   - maps the old exam track onto a neutral `active_subjects` list
   - sets a neutral `grade_level` when it is missing
   - renames the embedded `vault_documents` array to `resource_documents`
2. `syllabuses`
   - converts the legacy flat `chapters: [{topic_name, is_completed}]` list into
     the new hierarchy `subjects -> modules -> topics`
   - drops `exam_track`
3. Legacy collections
   - renames `vault_chat_logs` -> `library_chat_logs`
   - renames `vault_sources`   -> `resource_sources`
4. Legacy sample / mock records
   - deletes quiz attempts, mistake logs and SRS records whose content still
     mentions a specific competitive examination
5. Indexes
   - creates the indexes the new endpoints rely on

Usage
-----
    python -m scripts.migrate_general_hub --dry-run   # preview only
    python -m scripts.migrate_general_hub --apply      # write changes
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The Windows console defaults to cp1252, which cannot render the box-drawing
# characters used below.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # pragma: no cover - older/odd streams
    pass

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING

load_dotenv()

# Legacy exam track -> neutral subjects. The subject names themselves are
# perfectly general; only the *track* concept is being retired.
TRACK_TO_SUBJECTS = {
    "JEE": ["Physics", "Chemistry", "Mathematics"],
    "NEET": ["Physics", "Chemistry", "Biology"],
    "UPSC": ["History", "Geography", "Political Science", "Economics"],
    "GATE": ["Computer Science", "Mathematics", "General Aptitude"],
}

DEFAULT_GRADE_LEVEL = "Undergraduate"

# Any record whose text mentions one of these is considered legacy exam data.
EXAM_KEYWORDS = [
    "jee", "neet", "upsc", "gate", "cutoff", "aspirant", "mock test",
    "one shot", "crash course", "past year", "pyq", "rank predictor",
]


def _contains_exam_text(text) -> bool:
    if not text:
        return False
    lowered = str(text).lower()
    return any(keyword in lowered for keyword in EXAM_KEYWORDS)


def _has_exam_fields(doc: dict) -> bool:
    """True when the document carries an explicit legacy exam track."""
    for key in ("exam_track", "exam_date", "target_exam", "exam_year"):
        if doc.get(key):
            return True
    return False


class Migrator:
    def __init__(self, db, dry_run: bool = True):
        self.db = db
        self.dry_run = dry_run
        self.stats = {}

    def bump(self, key: str, amount: int = 1):
        self.stats[key] = self.stats.get(key, 0) + amount

    def log(self, message: str):
        prefix = "[DRY-RUN] " if self.dry_run else "[APPLIED]  "
        print(f"{prefix}{message}")

    # ── users ────────────────────────────────────────────────────────────────
    async def migrate_users(self):
        print("\n── users ──")
        cursor = self.db.users.find({})
        async for user in cursor:
            update = {}
            unset = {}

            legacy_track = user.get("exam_track")
            subjects = [s for s in (user.get("active_subjects") or []) if s]

            if not subjects and legacy_track:
                subjects = TRACK_TO_SUBJECTS.get(
                    str(legacy_track).upper(),
                    [str(legacy_track).title()],
                )
                update["active_subjects"] = subjects
                self.bump("users.exam_track_mapped")

            if "active_subjects" not in user:
                update.setdefault("active_subjects", [])

            if not user.get("grade_level"):
                update["grade_level"] = DEFAULT_GRADE_LEVEL
                self.bump("users.grade_level_defaulted")

            if "exam_track" in user or "exam_date" in user:
                unset["exam_track"] = ""
                unset["exam_date"] = ""
                self.bump("users.exam_fields_removed")

            # A legacy milestone date is still a valid, generic study milestone.
            legacy_date = user.get("exam_date")
            if legacy_date and not user.get("target_date"):
                update["target_date"] = legacy_date
                self.bump("users.exam_date_remapped")

            # Embedded resource documents
            if "vault_documents" in user:
                docs = []
                for doc in user.get("vault_documents", []) or []:
                    doc = dict(doc)
                    doc.setdefault("subject", "General")
                    docs.append(doc)
                update["resource_documents"] = docs
                unset["vault_documents"] = ""
                self.bump("users.vault_documents_renamed")

            if not update and not unset:
                continue

            self.log(
                f"user {user.get('username')}: "
                f"set={sorted(update.keys())} unset={sorted(unset.keys())}"
            )

            if not self.dry_run:
                ops = {}
                if update:
                    ops["$set"] = update
                if unset:
                    ops["$unset"] = unset
                await self.db.users.update_one({"_id": user["_id"]}, ops)

    # ── syllabuses ───────────────────────────────────────────────────────────
    async def migrate_syllabuses(self):
        print("\n── syllabuses (course trackers) ──")
        cursor = self.db.syllabuses.find({})
        async for syllabus in cursor:
            if "subjects" in syllabus:
                # Already migrated — just drop any leftover exam fields.
                if "exam_track" in syllabus:
                    self.log(f"syllabus {syllabus['_id']}: drop exam_track")
                    if not self.dry_run:
                        await self.db.syllabuses.update_one(
                            {"_id": syllabus["_id"]}, {"$unset": {"exam_track": ""}}
                        )
                    self.bump("syllabuses.exam_fields_removed")
                continue

            legacy_chapters = syllabus.get("chapters") or []
            if not legacy_chapters:
                continue

            user = await self.db.users.find_one({"master_syllabus_id": str(syllabus["_id"])})
            subjects = (user or {}).get("active_subjects") or []
            if not subjects:
                subjects = ["General Studies"]

            # Distribute the flat chapter list across the learner's subjects,
            # preserving the original chronological order.
            per_subject = max(1, len(legacy_chapters) // len(subjects))
            new_subjects = []
            for index, subject_name in enumerate(subjects):
                start = index * per_subject
                end = start + per_subject if index < len(subjects) - 1 else len(legacy_chapters)
                slice_ = legacy_chapters[start:end]
                if not slice_:
                    continue
                new_subjects.append({
                    "subject_name": subject_name,
                    "modules": [
                        {
                            "module_name": "Imported Outline",
                            "topics": [
                                {
                                    "topic_name": chapter.get("topic_name", "Untitled"),
                                    "is_completed": bool(chapter.get("is_completed")),
                                    "completed_at": chapter.get("completed_at"),
                                }
                                for chapter in slice_
                                if chapter.get("topic_name")
                            ],
                        }
                    ],
                })

            self.log(
                f"syllabus {syllabus['_id']}: {len(legacy_chapters)} chapters -> "
                f"{len(new_subjects)} subject(s)"
            )
            self.bump("syllabuses.restructured")

            if not self.dry_run:
                await self.db.syllabuses.update_one(
                    {"_id": syllabus["_id"]},
                    {
                        "$set": {
                            "subjects": new_subjects,
                            "title": syllabus.get("title") or "My Course",
                        },
                        "$unset": {"chapters": "", "exam_track": ""},
                    },
                )

    # ── legacy collection renames ────────────────────────────────────────────
    async def rename_collections(self):
        print("\n── legacy collection renames ──")
        existing = set(await self.db.list_collection_names())

        for old, new in [("vault_chat_logs", "library_chat_logs"),
                         ("vault_sources", "resource_sources"),
                         ("vault_history", "resource_history")]:
            if old in existing:
                self.log(f"rename collection {old} -> {new}")
                self.bump("collections.renamed")
                if not self.dry_run:
                    await self.db[old].rename(new)

    # ── legacy sample / mock records ─────────────────────────────────────────
    async def purge_exam_records(self):
        print("\n── legacy exam sample records ──")

        # Quiz attempts
        removed_attempts = 0
        async for attempt in self.db.quiz_attempts.find({}):
            topics = attempt.get("target_topics") or []
            blob = " ".join(str(t) for t in topics)
            if _contains_exam_text(blob):
                removed_attempts += 1
                if not self.dry_run:
                    await self.db.quiz_attempts.delete_one({"_id": attempt["_id"]})
        if removed_attempts:
            self.log(f"removed {removed_attempts} exam-flavoured quiz attempt(s)")
            self.bump("quiz_attempts.purged", removed_attempts)

        # Mistake logs
        removed_mistakes = 0
        async for mistake in self.db.mistake_logs.find({}):
            topics = mistake.get("target_topics") or []
            blob = " ".join(str(t) for t in topics) + " " + str(mistake.get("question", ""))
            if _contains_exam_text(blob):
                removed_mistakes += 1
                if not self.dry_run:
                    await self.db.mistake_logs.delete_one({"_id": mistake["_id"]})
        if removed_mistakes:
            self.log(f"removed {removed_mistakes} exam-flavoured mistake log(s)")
            self.bump("mistake_logs.purged", removed_mistakes)

        # SRS records
        removed_srs = 0
        async for record in self.db.srs_records.find({}):
            if _contains_exam_text(record.get("reference_id")):
                removed_srs += 1
                if not self.dry_run:
                    await self.db.srs_records.delete_one({"_id": record["_id"]})
        if removed_srs:
            self.log(f"removed {removed_srs} exam-flavoured SRS record(s)")
            self.bump("srs_records.purged", removed_srs)

        # Quizzes whose topic list is exam-flavoured
        removed_quizzes = 0
        async for quiz in self.db.quizzes.find({}):
            topics = quiz.get("target_topics") or []
            if _contains_exam_text(" ".join(str(t) for t in topics)):
                removed_quizzes += 1
                if not self.dry_run:
                    await self.db.quizzes.delete_one({"_id": quiz["_id"]})
        if removed_quizzes:
            self.log(f"removed {removed_quizzes} exam-flavoured quiz set(s)")
            self.bump("quizzes.purged", removed_quizzes)

    # ── indexes ──────────────────────────────────────────────────────────────
    async def create_indexes(self):
        print("\n── indexes ──")
        if self.dry_run:
            self.log("would create indexes on users / syllabuses / srs_records")
            return

        await self.db.users.create_index([("email", ASCENDING)], unique=True)
        await self.db.syllabuses.create_index([("user_id", ASCENDING)])
        await self.db.srs_records.create_index([("user_id", ASCENDING), ("reference_id", ASCENDING)])
        await self.db.srs_records.create_index([("next_review_date", ASCENDING)])
        await self.db.quiz_attempts.create_index([("user_id", ASCENDING), ("completed_at", DESCENDING)])
        self.log("indexes created")

    async def run(self):
        await self.migrate_users()
        await self.migrate_syllabuses()
        await self.rename_collections()
        await self.purge_exam_records()
        await self.create_indexes()

        print("\n── summary ──")
        if not self.stats:
            print("  nothing to migrate")
        for key, value in sorted(self.stats.items()):
            print(f"  {key}: {value}")


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually write the changes (default is a dry run)",
    )
    parser.add_argument("--uri", default=os.getenv("MONGO_URI", ""))
    parser.add_argument("--database", default=os.getenv("DATABASE_NAME", "lumen_db"))
    args = parser.parse_args()

    if not args.uri:
        print("MONGO_URI is not set. Configure it in backend/.env")
        sys.exit(1)

    client = AsyncIOMotorClient(args.uri)
    db = client.get_database(args.database)

    print(f"Database: {args.database}")
    print(f"Mode:     {'APPLY' if args.apply else 'DRY RUN'}")
    print("=" * 60)

    migrator = Migrator(db, dry_run=not args.apply)
    try:
        await migrator.run()
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
