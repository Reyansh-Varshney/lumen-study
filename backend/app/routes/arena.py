from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from app.core.security import get_current_user_ws
from app.utils.activity import log_user_activity
from app.core.database import get_database
from app.services.arena import manager
from app.services.llm import (
    generate_mcqs,
    generate_mcqs_from_context,
    generate_resource_mcqs,
    generate_adaptive_practice,
)
from app.services.course import (
    get_user_subjects,
    get_user_topics,
    subject_context,
)
import asyncio
import uuid
import logging
import random
from bson import ObjectId
from datetime import datetime, timezone
from app.utils.srs import calculate_next_review

router = APIRouter(prefix="/ws", tags=["Practice Arena"])
logger = logging.getLogger(__name__)


async def simulate_bot_game(match_id: str, real_player_ws: WebSocket, bot_id: str):
    bot_iq = random.uniform(0.40, 0.85)
    for _ in range(5):
        await asyncio.sleep(random.randint(4, 11))

        if match_id not in manager.active_matches:
            break

        match = manager.active_matches[match_id]
        if match.get("status") == "finished":
            break

        if random.random() <= bot_iq:
            match["players"][bot_id]["score"] += 1

        match["players"][bot_id]["answer_count"] += 1

        if match["players"][bot_id]["answer_count"] >= 5:
            match["players"][bot_id]["completed"] = True

        try:
            await real_player_ws.send_json({
                "type": "OPPONENT_PROGRESS",
                "opponent_score": match["players"][bot_id]["score"]
            })
        except Exception:
            pass

        # If bot reaches 5 questions, check if real player is already done
        if match["players"][bot_id]["completed"] and manager.check_match_complete(match_id):
            db = get_database()
            await manager.trigger_endgame(match_id, db)
            break


async def _build_practice_set(db, user_id: str, subjects: list) -> list:
    """
    Assemble a mixed question set for a general practice match.

    Topics come from the learner's own course tracker, so the questions always
    reflect what they are actually studying — never a hardcoded subject list.
    """
    topics = await get_user_topics(db, user_id)
    if not topics:
        # Fall back to the learner's subjects so a fresh learner still gets a
        # meaningful, subject-appropriate session.
        topics = list(subjects)

    if not topics:
        return await generate_mcqs("General Study Skills", subject_context(subjects))

    picked = random.sample(topics, min(len(topics), 3))
    selected = ", ".join(f"{subject_context(subjects)}: {topic}" for topic in picked)
    return await generate_mcqs(selected, subject_context(subjects))


@router.websocket("/arena")
async def websocket_arena(
    websocket: WebSocket,
    token: str = Query(...)
):
    try:
        user_id = await get_current_user_ws(token)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket)
    db = get_database()
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    elo = user.get("elo_rating", 1200)
    subjects = await get_user_subjects(db, user_id)
    subject = subjects[0] if subjects else "General Studies"
    context = subject_context(subjects)

    # Try to intercept the topic-scoped practice payload immediately
    initial_data = None
    try:
        initial_data = await asyncio.wait_for(websocket.receive_json(), timeout=0.5)
    except asyncio.TimeoutError:
        pass

    if initial_data and initial_data.get("type", "").upper() == "TOPIC_BOT_MATCH":
        target_topic = initial_data.get("topic", "General Study")
        match_id = f"TOPIC_MATCH_{uuid.uuid4().hex[:8]}"
        bot_id = "SRS_BOT"

        manager.active_matches[match_id] = {
            "players": {
                user_id: {"websocket": websocket, "score": 0, "answer_count": 0, "completed": False, "elo": elo},
                bot_id: {"websocket": None, "score": 0, "answer_count": 0, "completed": False, "elo": elo}
            },
            "status": "ongoing",
            "subject": subject,
            "target_topic": target_topic,
            "is_srs_match": True
        }

        await websocket.send_json({
            "type": "MATCH_FOUND",
            "opponent": bot_id
        })

        # Generate questions directly from the topic string
        questions = await generate_mcqs(target_topic, context)
        manager.active_matches[match_id]["questions"] = questions

        await websocket.send_json({
            "type": "BATTLE_START",
            "questions": questions
        })
        asyncio.create_task(simulate_bot_game(match_id, websocket, bot_id))
        is_starter = False
    elif initial_data and initial_data.get("type", "").upper() == "ADAPTIVE_BOT_MATCH":
        target_topic = initial_data.get("topic", "General")

        # Fetch past mistakes for context
        mistakes_cursor = db.mistake_logs.find({
            "user_id": {"$in": [user_id, ObjectId(user_id)]},
            "target_topics": target_topic
        }).sort("created_at", -1).limit(3)
        mistakes = await mistakes_cursor.to_list(length=3)
        mistake_texts = [m.get("question", "") for m in mistakes]

        match_id = f"ADAPTIVE_{uuid.uuid4().hex[:8]}"
        bot_id = "ADAPTIVE_BOT"

        manager.active_matches[match_id] = {
            "players": {
                user_id: {"websocket": websocket, "score": 0, "answer_count": 0, "completed": False, "elo": elo},
                bot_id: {"websocket": None, "score": 0, "answer_count": 0, "completed": False, "elo": elo}
            },
            "status": "ongoing",
            "subject": subject,
            "target_topic": target_topic,
            "is_srs_match": True
        }

        await websocket.send_json({
            "type": "MATCH_FOUND",
            "opponent": bot_id
        })

        questions = await generate_adaptive_practice(target_topic, mistake_texts, context)
        manager.active_matches[match_id]["questions"] = questions

        await websocket.send_json({
            "type": "BATTLE_START",
            "questions": questions
        })
        asyncio.create_task(simulate_bot_game(match_id, websocket, bot_id))
        is_starter = False
    elif initial_data and initial_data.get("type", "").upper() == "RESOURCE_BOT_MATCH":
        active_doc_ids = initial_data.get("active_doc_ids", [])
        match_id = f"RESOURCE_MATCH_{uuid.uuid4().hex[:8]}"
        bot_id = "RESOURCE_BOT"

        manager.active_matches[match_id] = {
            "players": {
                user_id: {"websocket": websocket, "score": 0, "answer_count": 0, "completed": False, "elo": elo},
                bot_id: {"websocket": None, "score": 0, "answer_count": 0, "completed": False, "elo": elo}
            },
            "status": "ongoing",
            "subject": subject,
            "resource_doc_ids": active_doc_ids
        }

        await websocket.send_json({
            "type": "MATCH_FOUND",
            "opponent": bot_id
        })

        questions = await generate_resource_mcqs(active_doc_ids, context)
        manager.active_matches[match_id]["questions"] = questions

        await websocket.send_json({
            "type": "BATTLE_START",
            "questions": questions
        })
        asyncio.create_task(simulate_bot_game(match_id, websocket, bot_id))
        is_starter = False
    else:
        # Standard queue logic
        match_id = await manager.find_match(user_id, elo, subject, websocket)
        is_starter = False

        if not match_id:
            # Wait up to 10 seconds for an opponent
            for _ in range(10):
                await asyncio.sleep(1)
                for m_id, m_data in manager.active_matches.items():
                    if user_id in m_data["players"]:
                        match_id = m_id
                        break
                if match_id:
                    break

        if not match_id:
            # Computer opponent fallback
            manager.remove_from_queue(user_id)
            match_id = manager.create_bot_match(user_id, elo, subject, websocket)
            bot_id = f"STUDY_BOT_{subject}_{elo}"

            await websocket.send_json({
                "type": "MATCH_FOUND",
                "opponent": bot_id
            })

            match = manager.active_matches[match_id]
            match["status"] = "ongoing"
            try:
                questions = await _build_practice_set(db, user_id, subjects)
                match["questions"] = questions
                await websocket.send_json({
                    "type": "BATTLE_START",
                    "questions": questions
                })
            except Exception as e:
                logger.error(f"Practice question generation failed: {e}")
                await manager.broadcast_to_match(match_id, {
                    "type": "MATCH_OVER",
                    "reason": "error",
                    "message": "The AI referee hit an error generating questions. Please queue again."
                })
                manager.active_matches.pop(match_id, None)
                try:
                    await websocket.close()
                except Exception:
                    pass
                return

            asyncio.create_task(simulate_bot_game(match_id, websocket, bot_id))
        else:
            is_starter = True

    if match_id and is_starter:
        match = manager.active_matches[match_id]
        players_list = list(match["players"].keys())
        p1 = players_list[0]
        p2 = players_list[1]

        try:
            await match["players"][p1]["websocket"].send_json({
                "type": "MATCH_FOUND",
                "opponent": f"Player {p2[-4:]}"
            })
            ws_p2 = match["players"][p2]["websocket"]
            if ws_p2:
                await ws_p2.send_json({
                    "type": "MATCH_FOUND",
                    "opponent": f"Player {p1[-4:]}"
                })
        except Exception:
            pass

        match["status"] = "ongoing"
        try:
            questions = await _build_practice_set(db, user_id, subjects)
            match["questions"] = questions
            await manager.broadcast_to_match(match_id, {
                "type": "BATTLE_START",
                "questions": questions
            })
        except Exception as e:
            logger.error(f"Practice question generation failed: {e}")
            await manager.broadcast_to_match(match_id, {
                "type": "MATCH_OVER",
                "reason": "error",
                "message": "The AI referee hit an error generating questions. Please queue again."
            })
            manager.active_matches.pop(match_id, None)
            try:
                if ws_p2:
                    await ws_p2.close()
            except Exception:
                pass
            try:
                if ws_p1:
                    await ws_p1.close()
            except Exception:
                pass
            return

    # Main real-time loop
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "").upper()

            if msg_type == "ANSWER_SUBMITTED":
                # --- ACTIVITY LOGGING ---
                await log_user_activity(db, str(user_id))

                is_correct = data.get("is_correct", False)
                time_taken = data.get("time_taken", 0)
                current_q_idx = data.get("question_idx", 0)
                user_match_id = None
                for m_id, m_data in manager.active_matches.items():
                    if user_id in m_data["players"]:
                        user_match_id = m_id
                        break

                if user_match_id:
                    match = manager.active_matches[user_match_id]
                    if is_correct:
                        match["players"][user_id]["score"] += 1

                    # --- ATOMIC INJECTION: WEAKNESS DETECTION ---
                    # If they got it wrong OR took more than 20 seconds, log it as a weakness
                    if not is_correct or time_taken > 20:
                        qs = match.get("questions", [])
                        current_q = qs[current_q_idx] if qs and current_q_idx < len(qs) else {}
                        q_text = current_q.get("question", "Unknown Question")
                        target_topic = match.get("target_topic", "General")

                        asyncio.create_task(db.mistake_logs.insert_one({
                            "user_id": user_id,
                            "match_id": user_match_id,
                            "target_topics": [target_topic],
                            "question": q_text,
                            "time_taken": time_taken,
                            "is_correct": is_correct,
                            "is_resolved": False,
                            "created_at": datetime.now(timezone.utc)
                        }))
                    # --- END INJECTION ---

                    match["players"][user_id]["answer_count"] += 1

                    if match["players"][user_id]["answer_count"] >= 5:
                        match["players"][user_id]["completed"] = True

                    # --- ATOMIC INJECTION: SRS CURVE UPDATE ---
                    if match.get("is_srs_match") and match.get("target_topic"):
                        topic = match["target_topic"]
                        score = match["players"][user_id]["score"]
                        quality = int((score / 5.0) * 5)  # Convert 0-5 score to SM-2 quality factor

                        srs_record = await db.srs_records.find_one({"user_id": user_id, "reference_id": topic})
                        cf = srs_record["ease_factor"] if srs_record else 2.5
                        interval = srs_record["interval"] if srs_record else 0

                        srs_result = calculate_next_review(quality, cf, interval)

                        await db.srs_records.update_one(
                            {"user_id": user_id, "reference_id": topic},
                            {
                                "$set": {
                                    "ease_factor": srs_result["ease_factor"],
                                    "interval": srs_result["interval"],
                                    "next_review_date": srs_result["next_review_date"],
                                    "last_reviewed_date": datetime.now(timezone.utc),
                                    "record_type": "topic"
                                },
                                "$inc": {"repetition_count": 1}
                            },
                            upsert=True
                        )
                    # --- END INJECTION ---

                    for p_id in match["players"]:
                        if p_id != user_id and match["players"][p_id]["websocket"]:
                            opponent_ws = match["players"][p_id]["websocket"]
                            try:
                                await opponent_ws.send_json({
                                    "type": "OPPONENT_PROGRESS",
                                    "opponent_score": match["players"][user_id]["score"]
                                })
                            except Exception:
                                pass

                    if manager.check_match_complete(user_match_id):
                        await manager.trigger_endgame(user_match_id, db)
                        break
                    elif match["players"][user_id]["completed"]:
                        try:
                            await websocket.send_json({
                                "type": "WAITING_FOR_OPPONENT",
                                "your_score": match["players"][user_id]["score"],
                                "message": "Waiting for opponent to finish..."
                            })
                        except Exception:
                            pass

    except WebSocketDisconnect:
        logger.info(f"User {user_id} disconnected.")
        manager.disconnect(websocket, user_id=user_id)

        user_match_id = None
        for m_id, m_data in manager.active_matches.items():
            if user_id in m_data["players"]:
                user_match_id = m_id
                break

        if user_match_id:
            logger.info(f"Connection dropped mid-match in {user_match_id}")
            await manager.handle_disconnect(user_match_id, user_id, db)
