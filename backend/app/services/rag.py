import os
import asyncio
import uuid
import httpx
import logging
import pymupdf as fitz  # PyMuPDF
from datetime import datetime
from fastapi import UploadFile, HTTPException
from langchain_text_splitters import RecursiveCharacterTextSplitter
import chromadb
from chromadb.config import Settings as ChromaSettings
from app.core.config import settings
from app.core.database import get_database
from bson import ObjectId

logger = logging.getLogger(__name__)

# Initialize ChromaDB persistent client
chroma_client = chromadb.PersistentClient(path=settings.CHROMA_DB_DIR)

# The vector store holds whatever the learner uploads — notes, textbooks,
# syllabus documents — for any subject. There is no pre-seeded, test-specific
# collection anywhere in this codebase.
COLLECTION_NAME = "study_resources"

_collection = None


def get_collection():
    """
    Return a live handle to the resource collection.

    The handle is cached for speed, but it is re-resolved when the underlying
    collection has been dropped and recreated (which gives it a new id).
    Without this, a long-running server would keep pointing at a collection
    that no longer exists and every upload would fail with
    ``NotFoundError``.
    """
    global _collection

    if _collection is not None:
        try:
            _collection.count()
            return _collection
        except Exception:
            logger.warning("Vector collection handle is stale — re-resolving it.")
            _collection = None

    _collection = chroma_client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )
    return _collection


def run_on_collection(operation, *args, **kwargs):
    """
    Run an operation against the resource collection.

    If the collection was dropped and recreated while the server was running,
    the cached handle points at a collection id that no longer exists. The
    operation is retried once against a freshly resolved handle.

    If the embedding model changed, the stored vectors have a different
    dimension and the collection is rebuilt rather than left unusable.
    """
    global _collection

    try:
        return operation(get_collection(), *args, **kwargs)
    except Exception as exc:
        message = str(exc).lower()

        if "does not exist" in message or type(exc).__name__ == "NotFoundError":
            logger.warning("Vector collection was replaced — re-resolving and retrying.")
            _collection = None
            return operation(get_collection(), *args, **kwargs)

        if "dimension" in message:
            # The embedding model changed, so the stored vectors no longer
            # match. Start a fresh collection instead of failing forever.
            logger.warning("Embedding dimension changed — rebuilding the vector collection.")
            _collection = None
            try:
                chroma_client.delete_collection(COLLECTION_NAME)
            except Exception:
                pass
            return operation(get_collection(), *args, **kwargs)

        raise


async def _embed_batch(chunks: list[str], input_type: str = "passage") -> list[list[float]]:
    """Embed a batch of chunks.

    Delegates to the shared embedding client, which uses NVIDIA NIM and falls
    back to Gemini.
    """
    from app.services.embeddings import embed

    delay = 2.0
    for _ in range(3):
        vectors = await embed(chunks, input_type=input_type)
        if vectors:
            return vectors
        logger.warning("Embedding attempt failed — retrying in %.0fs", delay)
        await asyncio.sleep(delay)
        delay *= 2

    return None


async def process_and_store_pdf(file: UploadFile, user_id: str, subject: str | None = None):
    """
    Ingest a learner-supplied document into the shared vector store.

    The pipeline is fully generic: any PDF (chapter notes, textbook extract,
    syllabus handout, article) can be attached to any subject the learner is
    studying.
    """
    doc_id = str(uuid.uuid4())
    filename = file.filename
    subject_label = (subject or "General").strip() or "General"

    # 1. Extract text
    try:
        content = await file.read()
        doc = fitz.open(stream=content, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read PDF: {str(e)}")

    pages = []
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        text = page.get_text("text")
        if text.strip():
            pages.append({"page": page_num + 1, "text": text})

    if not pages:
        raise HTTPException(status_code=400, detail="PDF contains no extractable text.")

    # 2. Split text
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)

    all_chunks = []
    all_metadatas = []
    all_ids = []

    for p in pages:
        page_chunks = splitter.split_text(p["text"])
        for i, chunk in enumerate(page_chunks):
            all_chunks.append(chunk)
            all_metadatas.append({
                "doc_id": doc_id,
                "doc_name": filename,
                "page": p["page"],
                "user_id": user_id,
                "subject": subject_label,
            })
            all_ids.append(f"{doc_id}_{p['page']}_{i}")

    # 3. Process in batches of 100
    docs_to_insert = []
    metadatas = []
    ids = []
    embeddings = []

    batch_size = 100
    total_chunks = len(all_chunks)

    for i in range(0, total_chunks, batch_size):
        chunk_batch = all_chunks[i:i+batch_size]
        meta_batch = all_metadatas[i:i+batch_size]
        id_batch = all_ids[i:i+batch_size]

        batch_embs = await _embed_batch(chunk_batch)

        if batch_embs is None:
            raise HTTPException(
                status_code=503,
                detail=f"Google API is currently overloaded. Embedded {len(docs_to_insert)} out of {total_chunks} chunks. Please try uploading again in a minute."
            )

        for chunk, meta, cid, emb in zip(chunk_batch, meta_batch, id_batch, batch_embs):
            if emb:
                docs_to_insert.append(chunk)
                metadatas.append(meta)
                ids.append(cid)
                embeddings.append(emb)

        logger.info(f"Embedded batch {i} to {i+len(chunk_batch)}...")
        # Mandatory pacing length limit
        await asyncio.sleep(2.0)

    # 4. Storage in ChromaDB
    if docs_to_insert:
        run_on_collection(
            lambda col: col.add(
                documents=docs_to_insert,
                metadatas=metadatas,
                ids=ids,
                embeddings=embeddings
            )
        )

    # 5. Metadata to MongoDB
    db = get_database()
    upload_doc = {
        "doc_id": doc_id,
        "doc_name": filename,
        "subject": subject_label,
        "uploaded_at": datetime.utcnow().isoformat()
    }
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$push": {"resource_documents": upload_doc}}
    )

    return {
        "message": "Document uploaded successfully",
        "doc_id": doc_id,
        "doc_name": filename,
        "subject": subject_label,
    }


async def generate_resource_answer(question: str, active_doc_ids: list[str], socratic_mode: bool, user_id: str) -> dict:
    """Answer a question using only the learner's own uploaded documents."""
    # 1. Semantic Search
    question_embs = await _embed_batch([question], input_type="query")

    if not question_embs or not question_embs[0]:
        raise HTTPException(status_code=500, detail="Failed to embed question")

    question_embedding = question_embs[0]

    query_results = run_on_collection(
        lambda col: col.query(
            query_embeddings=[question_embedding],
            n_results=5,
            where={"doc_id": {"$in": active_doc_ids}} if active_doc_ids else None
        )
    )

    context_chunks = []
    if query_results["documents"] and len(query_results["documents"]) > 0:
        docs = query_results["documents"][0]
        meta = query_results["metadatas"][0]
        for d, m in zip(docs, meta):
            context_chunks.append(f"Context from {m['doc_name']} Page {m['page']}:\n{d}")

    context_text = "\n\n---\n\n".join(context_chunks)

    # 2. Prompt Engineering
    if not socratic_mode:
        system_instruction = (
            "You are a supportive academic mentor and study partner. "
            "Answer the user's question using ONLY the provided context chunks. "
            "IMPORTANT: Immediately after stating a fact from the context, add a citation tag EXACTLY like this: [DocName, Page X]. "
            "Do NOT include square brackets for anything else except citations."
        )
    else:
        system_instruction = (
            "You are a Socratic Tutor. Do NOT give the final answer. "
            "Analyze the provided context and ask a leading question to guide the student to the answer themselves. "
            "Add a citation tag EXACTLY like this: [DocName, Page X] when referencing context."
        )

    system_instruction += (
        " LANGUAGE DETECT AND MIRROR: Analyze the language of the user's question. If the user asks the question in Hindi (Devanagari script) or Hinglish (Hindi written in English alphabet), you MUST output your 'answer' field entirely in that exact same language/style. Explain complex terms simply. Keep the 'concept_nodes' and 'concept_edges' in English for system compatibility."
    )

    # JSON schema output — the concept graph is fully generic: whatever subject
    # the learner's document belongs to becomes level 2.
    system_instruction += (
        "\n\nYou MUST return a valid JSON object with EXACTLY this structure. "
        "Build the concept graph as a strict 4-level hierarchy:\n"
        "Level 1: The Source Document (connects to Level 2)\n"
        "Level 2: The Subject or Category of the document (connects to Level 3)\n"
        "Level 3: The Specific Concepts or Chapters (connects to Level 4)\n"
        "Level 4: Key Definitions, Formulas or Takeaways\n"
        "{\n"
        '  "answer": "Detailed markdown explanation with [DocName, Page X] citations.",\n'
        '  "concept_nodes": [\n'
        '    {"id": "doc_1", "label": "Document Name"},\n'
        '    {"id": "subject_1", "label": "Subject Name"},\n'
        '    {"id": "concept_2", "label": "Concept Name", "formula_or_detail": "Key detail"}\n'
        '  ],\n'
        '  "concept_edges": [{"source": "Concept1", "target": "DocName", "label": "found in"}]\n'
        "}\n"
        "Ensure the JSON is strictly valid."
    )

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={settings.GEMINI_API_KEY}"
    payload = {
        "system_instruction": {"parts": [{"text": system_instruction}]},
        "contents": [
            {
                "role": "user",
                "parts": [{"text": f"Context:\n{context_text}\n\nQuestion:\n{question}"}]
            }
        ],
        "generationConfig": {
            "temperature": 0.3 if not socratic_mode else 0.7,
            "responseMimeType": "application/json"
        }
    }

    from app.services.llm import _generate

    schema = {
        "type": "object",
        "properties": {
            "answer": {"type": "string"},
            "concept_nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "label": {"type": "string"},
                        "formula_or_detail": {"type": "string"},
                    },
                    "required": ["id", "label"],
                },
            },
            "concept_edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "source": {"type": "string"},
                        "target": {"type": "string"},
                        "label": {"type": "string"},
                    },
                    "required": ["source", "target"],
                },
            },
        },
        "required": ["answer", "concept_nodes", "concept_edges"],
    }

    result = await _generate(
        system_instruction,
        f"Context:\n{context_text}\n\nQuestion:\n{question}",
        schema=schema,
        temperature=0.3 if not socratic_mode else 0.7,
    )

    if not isinstance(result, dict) or "answer" not in result:
        logger.error("The model did not return a usable structured answer.")
        raise HTTPException(status_code=500, detail="Failed to parse structured answer from AI")

    return result


async def generate_practice_from_scratchpad(text: str, user_id: str) -> dict:
    """Turn a learner's own notes into practice questions."""
    system_instruction = (
        "You are a supportive academic mentor. Generate exactly 3 Multiple Choice Questions (MCQs) "
        "based on the provided text. Keep the explanation concise and focused on the reasoning. "
        "Return only a JSON array of exactly 3 objects, each with the keys "
        "'question', 'options' (exactly 4 strings), 'correct_answer' and 'explanation'. "
        "Output raw JSON only."
    )

    from app.services.llm import _generate, MCQ_SCHEMA

    mcqs = await _generate(
        system_instruction,
        text,
        schema=MCQ_SCHEMA,
        temperature=0.5,
    )

    if not isinstance(mcqs, list) or not mcqs:
        raise HTTPException(status_code=500, detail="Failed to generate practice questions")

    db = get_database()
    # Save to the learner's practice queue
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$push": {"srs_queue": {"$each": mcqs}}}
    )
    return {"message": "Practice questions generated successfully", "mcqs": mcqs}
