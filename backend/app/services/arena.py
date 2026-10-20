from typing import List, Dict, Any
from fastapi import WebSocket
import uuid
from bson import ObjectId
from app.utils.elo import calculate_new_elos

from app.core.constants import DEFAULT_SUBJECT

# Bot identifier prefix used to mark computer opponents in a match.
BOT_PREFIX = "STUDY_BOT"


class ConnectionManager:
    """
    Manages live practice matches.

    Queues are keyed by *subject* rather than by any fixed test track,
    so a learner studying history never waits behind a chemistry player.
    """

    def __init__(self):
        self.waiting_queues: Dict[str, List[Dict[str, Any]]] = {}
        self.active_matches: Dict[str, Dict[str, Any]] = {}

    def _queue_for(self, subject: str) -> List[Dict[str, Any]]:
        key = subject or DEFAULT_SUBJECT
        return self.waiting_queues.setdefault(key, [])

    async def connect(self, websocket: WebSocket):
        await websocket.accept()

    def disconnect(self, websocket: WebSocket, user_id: str | None = None):
        for track in list(self.waiting_queues.keys()):
            self.waiting_queues[track] = [p for p in self.waiting_queues[track] if p["websocket"] != websocket]

    def remove_from_queue(self, user_id: str):
        for track in list(self.waiting_queues.keys()):
            self.waiting_queues[track] = [p for p in self.waiting_queues[track] if p["user_id"] != user_id]

    async def find_match(self, user_id: str, elo_rating: int, subject: str, websocket: WebSocket) -> str | None:
        subject = subject or DEFAULT_SUBJECT
        queue = self._queue_for(subject)

        valid_opponents = [p for p in queue if p["user_id"] != user_id]
        if valid_opponents:
            opponent = valid_opponents[0]
            self.waiting_queues[subject] = [p for p in queue if p["user_id"] != opponent["user_id"]]

            match_id = str(uuid.uuid4())
            self.active_matches[match_id] = {
                "subject": subject,
                "players": {
                    user_id: {"websocket": websocket, "score": 0, "elo": elo_rating, "completed": False, "answer_count": 0},
                    opponent["user_id"]: {"websocket": opponent["websocket"], "score": 0, "elo": opponent["elo"], "completed": False, "answer_count": 0}
                },
                "questions": [],
                "status": "waiting"
            }
            return match_id
        else:
            if not any(p["user_id"] == user_id for p in queue):
                self._queue_for(subject).append({
                    "user_id": user_id,
                    "elo": elo_rating,
                    "websocket": websocket
                })
            return None

    def create_bot_match(self, user_id: str, elo_rating: int, subject: str, websocket: WebSocket) -> str:
        subject = subject or DEFAULT_SUBJECT
        match_id = str(uuid.uuid4())
        bot_id = f"{BOT_PREFIX}_{subject}_{elo_rating}"
        self.active_matches[match_id] = {
            "subject": subject,
            "players": {
                user_id: {"websocket": websocket, "score": 0, "elo": elo_rating, "completed": False, "answer_count": 0},
                bot_id: {"websocket": None, "score": 0, "elo": elo_rating, "completed": False, "answer_count": 0}
            },
            "questions": [],
            "status": "waiting"
        }
        return match_id

    def check_match_complete(self, match_id: str) -> bool:
        if match_id not in self.active_matches:
            return False
        match = self.active_matches[match_id]
        return all(p.get("completed", False) for p in match["players"].values())

    async def trigger_endgame(self, match_id: str, db):
        if match_id not in self.active_matches:
            return

        match = self.active_matches[match_id]
        player_ids = list(match["players"].keys())
        if len(player_ids) != 2:
            return

        p1_id = player_ids[0]
        p2_id = player_ids[1]

        score_p1 = match["players"][p1_id]["score"]
        score_p2 = match["players"][p2_id]["score"]

        elo_p1 = match["players"][p1_id]["elo"]
        elo_p2 = match["players"][p2_id]["elo"]

        new_elo_p1, new_elo_p2 = calculate_new_elos(elo_p1, elo_p2, score_p1, score_p2)

        if not p1_id.startswith(BOT_PREFIX):
            try:
                await db["users"].update_one({"_id": ObjectId(p1_id)}, {"$set": {"elo_rating": new_elo_p1}})
            except Exception:
                pass

            ws_p1 = match["players"][p1_id]["websocket"]
            if ws_p1:
                try:
                    await ws_p1.send_json({
                        "type": "MATCH_OVER",
                        "your_score": score_p1,
                        "opponent_score": score_p2,
                        "new_elo": new_elo_p1
                    })
                    await ws_p1.close()
                except Exception:
                    pass

        if not p2_id.startswith(BOT_PREFIX):
            try:
                await db["users"].update_one({"_id": ObjectId(p2_id)}, {"$set": {"elo_rating": new_elo_p2}})
            except Exception:
                pass

            ws_p2 = match["players"][p2_id]["websocket"]
            if ws_p2:
                try:
                    await ws_p2.send_json({
                        "type": "MATCH_OVER",
                        "your_score": score_p2,
                        "opponent_score": score_p1,
                        "new_elo": new_elo_p2
                    })
                    await ws_p2.close()
                except Exception:
                    pass

        if match_id in self.active_matches:
            self.active_matches.pop(match_id, None)

    async def handle_disconnect(self, match_id: str, quitter_id: str, db):
        if match_id not in self.active_matches:
            return
        match = self.active_matches[match_id]
        player_ids = list(match["players"].keys())
        if len(player_ids) != 2:
            return

        survivor_id = player_ids[0] if player_ids[1] == quitter_id else player_ids[1]

        match["players"][quitter_id]["score"] = 0
        match["players"][survivor_id]["score"] = 5

        quitter_elo = match["players"][quitter_id]["elo"]
        survivor_elo = match["players"][survivor_id]["elo"]

        new_quitter_elo, new_survivor_elo = calculate_new_elos(quitter_elo, survivor_elo, 0, 5)

        if not quitter_id.startswith(BOT_PREFIX):
            try:
                await db["users"].update_one({"_id": ObjectId(quitter_id)}, {"$set": {"elo_rating": new_quitter_elo}})
            except Exception:
                pass

        if not survivor_id.startswith(BOT_PREFIX):
            try:
                await db["users"].update_one(
                    {"_id": ObjectId(survivor_id)},
                    {"$set": {"elo_rating": new_survivor_elo}, "$inc": {"xp": 50}}
                )
            except Exception:
                pass

            survivor_ws = match["players"][survivor_id]["websocket"]
            if survivor_ws:
                try:
                    await survivor_ws.send_json({
                        "type": "MATCH_OVER",
                        "reason": "opponent_disconnected",
                        "your_score": 5,
                        "opponent_score": 0,
                        "your_new_elo": new_survivor_elo,
                        "message": "Opponent disconnected. You win by forfeit."
                    })
                    await survivor_ws.close()
                except Exception:
                    pass

        self.active_matches.pop(match_id, None)

    async def broadcast_to_match(self, match_id: str, message: dict):
        if match_id in self.active_matches:
            players = self.active_matches[match_id]["players"]
            for player_id in players:
                ws = players[player_id]["websocket"]
                if ws:
                    try:
                        await ws.send_json(message)
                    except Exception:
                        pass


manager = ConnectionManager()
