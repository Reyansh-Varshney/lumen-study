"""
End-to-end checks for the Lumen API.

These exercise the refactored surface against a running MongoDB:
the generic learner profile, the Subject -> Module -> Topic course tracker,
and the subject-agnostic dashboard / planner endpoints.

Run with:
    python -m pytest backend/tests/test_general_hub.py -v
or
    python backend/tests/test_general_hub.py
"""

import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def account():
    stamp = uuid.uuid4().hex[:10]
    return {
        "username": f"study_{stamp}",
        "email": f"study_{stamp}@example.org",
        "password": "Lumen!2345",
        "grade_level": "Undergraduate",
        "academic_goal": "Build a solid foundation",
        "active_subjects": ["Mathematics", "History"],
    }


@pytest.fixture(scope="module")
def auth(account, client):
    response = client.post("/auth/register", json=account)
    assert response.status_code == 200, response.text

    login = client.post(
        "/auth/login",
        data={"username": account["email"], "password": account["password"]},
    )
    assert login.status_code == 200, login.text

    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ── Learner profile ─────────────────────────────────────────────────────────
def test_health_check(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Lumen" in response.json()["message"]


def test_register_rejects_duplicate_email(account, auth, client):
    # Depends on `auth` so the account is already registered by this point.
    response = client.post("/auth/register", json=account)
    assert response.status_code == 400


def test_me_returns_generic_profile(auth, client):
    response = client.get("/auth/me", headers=auth)
    assert response.status_code == 200

    body = response.json()
    assert body["grade_level"] == "Undergraduate"
    assert body["academic_goal"] == "Build a solid foundation"
    assert body["active_subjects"] == ["Mathematics", "History"]

    # The legacy test-specific fields must be gone for good.
    assert "exam_track" not in body
    assert "exam_date" not in body


def test_profile_can_be_updated(auth, client):
    response = client.patch(
        "/auth/profile",
        headers=auth,
        json={"grade_level": "Postgraduate", "active_subjects": ["Philosophy"]},
    )
    assert response.status_code == 200

    body = response.json()["profile"]
    assert body["grade_level"] == "Postgraduate"
    assert body["active_subjects"] == ["Philosophy"]


# ── Course tracker: Subject -> Module -> Topic ──────────────────────────────
def test_create_subject_module_and_topic(auth, client):
    created = client.post(
        "/syllabus/subjects",
        headers=auth,
        json={"subject_name": "Philosophy"},
    )
    assert created.status_code == 200, created.text

    module = client.post(
        "/syllabus/subjects/Philosophy/modules",
        headers=auth,
        json={"module_name": "Ethics"},
    )
    assert module.status_code == 200, module.text

    topic = client.post(
        "/syllabus/subjects/Philosophy/modules/Ethics/topics",
        headers=auth,
        json={"topic_name": "Utilitarianism"},
    )
    assert topic.status_code == 200, topic.text

    # Adding the same topic twice must be rejected.
    duplicate = client.post(
        "/syllabus/subjects/Philosophy/modules/Ethics/topics",
        headers=auth,
        json={"topic_name": "Utilitarianism"},
    )
    assert duplicate.status_code == 409


def test_roadmap_exposes_the_hierarchy(auth, client):
    response = client.get("/syllabus/my-roadmap", headers=auth)
    assert response.status_code == 200

    data = response.json()["data"]
    assert data is not None

    # The legacy flat chapter list and test track must be gone.
    assert "chapters" not in data
    assert "exam_track" not in data

    subjects = {s["subject_name"]: s for s in data["subjects"]}
    assert "Philosophy" in subjects

    modules = {m["module_name"]: m for m in subjects["Philosophy"]["modules"]}
    assert "Ethics" in modules

    topic_names = [t["topic_name"] for t in modules["Ethics"]["topics"]]
    assert "Utilitarianism" in topic_names


def test_topic_can_be_marked_complete(auth, client):
    response = client.patch(
        "/syllabus/topic",
        headers=auth,
        json={
            "subject_name": "Philosophy",
            "module_name": "Ethics",
            "topic_name": "Utilitarianism",
            "is_completed": True,
        },
    )
    assert response.status_code == 200
    assert response.json()["is_completed"] is True

    roadmap = client.get("/syllabus/my-roadmap", headers=auth).json()["data"]
    subject = next(s for s in roadmap["subjects"] if s["subject_name"] == "Philosophy")
    module = next(m for m in subject["modules"] if m["module_name"] == "Ethics")
    topic = next(t for t in module["topics"] if t["topic_name"] == "Utilitarianism")
    assert topic["is_completed"] is True
    assert topic["completed_at"] is not None


def test_unknown_topic_returns_404(auth, client):
    response = client.patch(
        "/syllabus/topic",
        headers=auth,
        json={
            "subject_name": "Philosophy",
            "module_name": "Ethics",
            "topic_name": "Does not exist",
            "is_completed": True,
        },
    )
    assert response.status_code == 404


def test_subject_can_be_removed(auth, client):
    removed = client.delete("/syllabus/subjects/Philosophy", headers=auth)
    assert removed.status_code == 200

    roadmap = client.get("/syllabus/my-roadmap", headers=auth).json()["data"]
    names = [s["subject_name"] for s in roadmap["subjects"]]
    assert "Philosophy" not in names


# ── Concurrency regression ───────────────────────────────────────────────────
def test_parallel_subject_creation_does_not_lose_updates(auth, client):
    """
    The onboarding flow submits every chosen subject at once.

    A read-modify-write of the `subjects` array would let the last request
    overwrite the ones before it, and a non-atomic course creation would
    produce one tracker document per request.
    """
    import concurrent.futures

    names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]

    def create(name):
        return client.post(
            "/syllabus/subjects",
            headers=auth,
            json={"subject_name": name},
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(names)) as pool:
        responses = list(pool.map(create, names))

    assert all(r.status_code == 200 for r in responses), [r.status_code for r in responses]

    roadmap = client.get("/syllabus/my-roadmap", headers=auth).json()["data"]
    stored = {s["subject_name"] for s in roadmap["subjects"]}
    missing = [n for n in names if n not in stored]
    assert not missing, f"lost subjects: {missing}"


def test_duplicate_subject_is_rejected(auth, client):
    created = client.post(
        "/syllabus/subjects",
        headers=auth,
        json={"subject_name": "Duplicated"},
    )
    assert created.status_code == 200

    duplicate = client.post(
        "/syllabus/subjects",
        headers=auth,
        json={"subject_name": "Duplicated"},
    )
    assert duplicate.status_code == 409


def test_parallel_module_creation_does_not_lose_updates(auth, client):
    """Modules are appended with `$push` too, so they must not race."""
    import concurrent.futures

    client.post("/syllabus/subjects", headers=auth, json={"subject_name": "Parallel"})

    modules = ["M1", "M2", "M3", "M4"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(modules)) as pool:
        list(pool.map(
            lambda m: client.post(
                "/syllabus/subjects/Parallel/modules",
                headers=auth, json={"module_name": m},
            ),
            modules,
        ))

    roadmap = client.get("/syllabus/my-roadmap", headers=auth).json()["data"]
    subject = next(s for s in roadmap["subjects"] if s["subject_name"] == "Parallel")
    stored = {m["module_name"] for m in subject["modules"]}
    missing = [m for m in modules if m not in stored]
    assert not missing, f"lost modules: {missing}"


# ── Subject-agnostic dashboard & planner ─────────────────────────────────────
def test_dashboard_metrics_are_subject_derived(auth, client):
    response = client.get("/dashboard/metrics", headers=auth)
    assert response.status_code == 200

    body = response.json()
    assert "exam_track" not in body
    assert body["grade_level"] == "Postgraduate"
    assert "Philosophy" in body["active_subjects"]

    # The radar must be built from the learner's own subjects.
    radar_subjects = [entry["subject"] for entry in body["mastery_radar"]]
    assert "Philosophy" in radar_subjects
    assert "Physics" not in radar_subjects


def test_daily_plan_uses_generic_action_types(auth, client):
    response = client.get("/planner/daily", headers=auth)
    assert response.status_code == 200

    plan = response.json()
    assert isinstance(plan, list)

    allowed = {"resource_study", "practice_arena", "practice_test", "revision"}
    for task in plan:
        assert task["action_type"] in allowed, task


def test_quiz_recommendations_endpoint(auth, client):
    response = client.get("/quiz/recommendations", headers=auth)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
