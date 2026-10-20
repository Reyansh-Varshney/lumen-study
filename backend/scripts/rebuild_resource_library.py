"""
Rebuild the `study_resources` vector collection from recovered chunk metadata.

The legacy `vault_docs` collection shipped with the repository held documents
that a learner had uploaded while testing the app, plus one exam-seeded
document. Dropping the collection removes the rows from the b-tree, so this
script:

1. reads recovered chunk metadata (see ``_sqlite_carver.py``),
2. re-embeds every chunk with the same Gemini embedding model the app uses,
3. writes them into the generic ``study_resources`` collection with clean,
   subject-aware metadata,
4. leaves the legacy collection removed.

Usage
-----
    python -m scripts.rebuild_resource_library --chunks recovered_chunks.json
"""

import argparse
import asyncio
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

import chromadb
import httpx

from app.core.config import settings

TARGET_COLLECTION = "study_resources"
LEGACY_COLLECTION = "vault_docs"
EMBEDDING_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"gemini-embedding-001:batchEmbedContents?key={settings.GEMINI_API_KEY}"
)


async def embed_batch(chunks: list[str]) -> list[list[float]]:
    """Embed a batch of chunks, exactly like the application does.

    The embedding API is aggressively rate limited, so we retry with
    exponential backoff and keep the batch small.
    """
    requests = [
        {"model": "models/gemini-embedding-001", "content": {"parts": [{"text": chunk}]}}
        for chunk in chunks
    ]

    delay = 4.0
    for attempt in range(8):
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(EMBEDDING_URL, json={"requests": requests})

            if response.status_code == 200:
                data = response.json()
                return [emb.get("values", []) for emb in data.get("embeddings", [])]

            if response.status_code == 429:
                print(f"    rate limited (429), backing off {delay:.0f}s ...")
                await asyncio.sleep(delay)
                delay = min(delay * 2, 120)
                continue

            raise RuntimeError(f"Embedding API error {response.status_code}: {response.text[:200]}")
        except httpx.HTTPError as exc:
            print(f"    request error ({type(exc).__name__}), backing off {delay:.0f}s ...")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 120)

    raise RuntimeError("Embedding API kept rate limiting this batch.")


def build_records(chunks: list[dict]) -> list[dict]:
    """
    Turn recovered chunks into records ready for chroma.

    The original string id followed the pattern ``{doc_id}_{page}_{index}``,
    which we reproduce so the ids stay stable and unique.
    """
    per_page = defaultdict(int)
    seen_ids = set()
    records = []

    for chunk in chunks:
        doc_id = chunk["doc_id"]
        page = chunk["page"]
        index = per_page[(doc_id, page)]
        per_page[(doc_id, page)] += 1

        embedding_id = f"{doc_id}_{page}_{index}"
        if embedding_id in seen_ids:
            continue
        seen_ids.add(embedding_id)

        records.append({
            "id": embedding_id,
            "document": chunk["document"],
            "metadata": {
                "doc_id": doc_id,
                "doc_name": chunk["doc_name"],
                "page": page,
                "user_id": chunk["user_id"],
                "subject": "General",
            },
        })

    return records


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chunks", required=True, help="Path to the recovered chunks JSON")
    parser.add_argument("--db-dir", default=settings.CHROMA_DB_DIR)
    parser.add_argument("--batch-size", type=int, default=50)
    args = parser.parse_args()

    with open(args.chunks, "r", encoding="utf-8") as fh:
        chunks = json.load(fh)

    records = build_records(chunks)
    print(f"Prepared {len(records)} chunk(s) for re-embedding.")

    client = chromadb.PersistentClient(path=args.db_dir)

    # Start clean so the rebuild is idempotent.
    if TARGET_COLLECTION in {c.name for c in client.list_collections()}:
        client.delete_collection(TARGET_COLLECTION)
    collection = client.get_or_create_collection(
        name=TARGET_COLLECTION,
        metadata={"hnsw:space": "cosine"},
    )

    for start in range(0, len(records), args.batch_size):
        batch = records[start:start + args.batch_size]
        vectors = await embed_batch([r["document"] for r in batch])

        good = [(r, v) for r, v in zip(batch, vectors) if v]
        if good:
            collection.add(
                ids=[r["id"] for r, _ in good],
                documents=[r["document"] for r, _ in good],
                metadatas=[r["metadata"] for r, _ in good],
                embeddings=[v for _, v in good],
            )

        print(f"  embedded {min(start + args.batch_size, len(records))}/{len(records)}")
        await asyncio.sleep(2.0)

    if LEGACY_COLLECTION in {c.name for c in client.list_collections()}:
        client.delete_collection(LEGACY_COLLECTION)
        print(f"Removed legacy collection '{LEGACY_COLLECTION}'.")

    final = client.get_collection(TARGET_COLLECTION)
    print(f"\n'{TARGET_COLLECTION}' now holds {final.count()} chunk(s).")


if __name__ == "__main__":
    asyncio.run(main())
