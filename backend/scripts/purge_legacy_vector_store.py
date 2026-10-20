"""
Clean the vector store of legacy, exam-seeded content.

The platform is now a general study hub, so the ChromaDB store should only
hold what the learner actually uploaded. This script:

1. Reports every collection and document currently in the vector store.
2. Copies the learner's own documents into the new, generic
   ``study_resources`` collection.
3. Drops the legacy ``vault_docs`` collection.
4. Deletes the legacy PCM seed document (``pcm_concepts.pdf``), which was
   bundled for the old physics/chemistry/mathematics exam track.

Usage
-----
    python -m scripts.purge_legacy_vector_store --dry-run
    python -m scripts.purge_legacy_vector_store --apply
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

import chromadb

# Legacy collection that shipped with the exam-specific build.
LEGACY_COLLECTION = "vault_docs"

# The generic collection the application now reads from.
TARGET_COLLECTION = "study_resources"

# Legacy seeded documents that must not survive the migration.
LEGACY_SEED_DOCS = {"pcm_concepts.pdf"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually modify the vector store (default is a dry run)",
    )
    parser.add_argument("--db-dir", default=os.getenv("CHROMA_DB_DIR", "./chroma_db"))
    args = parser.parse_args()

    dry_run = not args.apply
    mode = "DRY RUN" if dry_run else "APPLY"
    print(f"Vector store: {args.db_dir}")
    print(f"Mode:         {mode}")
    print("=" * 60)

    client = chromadb.PersistentClient(path=args.db_dir)
    existing = {c.name: c for c in client.list_collections()}
    print(f"Collections found: {list(existing.keys())}")

    legacy = existing.get(LEGACY_COLLECTION)
    if legacy is None:
        print(f"\nNo legacy '{LEGACY_COLLECTION}' collection present — nothing to migrate.")
    else:
        count = legacy.count()
        print(f"\nLegacy collection '{LEGACY_COLLECTION}' holds {count} chunk(s).")

        doc_names = sorted({
            m.get("doc_name", "?")
            for m in legacy.get(include=["metadatas"])["metadatas"] or []
        })
        print("Documents inside it:")
        for name in doc_names:
            marker = "  <- legacy seed, will be dropped" if name in LEGACY_SEED_DOCS else ""
            print(f"   - {name}{marker}")

        # 1. Create the generic target collection
        target = client.get_or_create_collection(
            name=TARGET_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )

        # 2. Copy the learner's own documents across, skipping legacy seeds
        data = legacy.get(include=["documents", "metadatas", "embeddings"])
        legacy_ids = data.get("ids") or []
        legacy_docs = data.get("documents") or []
        legacy_metas = data.get("metadatas") or []
        # NOTE: embeddings may be a numpy array, so avoid truthiness checks here.
        legacy_embs = data.get("embeddings")
        if legacy_embs is None:
            legacy_embs = []
        elif not isinstance(legacy_embs, list):
            legacy_embs = list(legacy_embs)

        keep_ids, keep_docs, keep_metas, keep_embs = [], [], [], []
        for index, doc_id in enumerate(legacy_ids):
            metadata = legacy_metas[index] if index < len(legacy_metas) else {}
            if metadata.get("doc_name") in LEGACY_SEED_DOCS:
                continue
            keep_ids.append(doc_id)
            keep_docs.append(legacy_docs[index] if index < len(legacy_docs) else None)
            keep_metas.append(metadata)
            keep_embs.append(legacy_embs[index] if index < len(legacy_embs) else None)

        print(f"\n{len(keep_ids)} chunk(s) would be carried over into '{TARGET_COLLECTION}' "
              f"({len(legacy_ids) - len(keep_ids)} legacy seed chunk(s) dropped).")

        if dry_run:
            print(f"[DRY RUN] would delete collection '{LEGACY_COLLECTION}'.")
        else:
            if keep_ids:
                target.add(
                    ids=keep_ids,
                    documents=keep_docs,
                    metadatas=keep_metas,
                    embeddings=keep_embs,
                )
                print(f"Copied {len(keep_ids)} chunk(s) into '{TARGET_COLLECTION}'.")

            client.delete_collection(LEGACY_COLLECTION)
            print(f"Deleted collection '{LEGACY_COLLECTION}'.")

    # 3. Make sure the target collection always exists
    client.get_or_create_collection(name=TARGET_COLLECTION, metadata={"hnsw:space": "cosine"})

    final = client.get_collection(TARGET_COLLECTION)
    print(f"\n'{TARGET_COLLECTION}' now holds {final.count()} chunk(s).")
    print("Done.")


if __name__ == "__main__":
    main()
