"""
Thorough Playwright test of the refactored Lumen.

Follows the webapp-testing skill: reconnaissance-then-action, `networkidle`
waits, headless chromium, and console-error capture.

Run with the servers already up:
    python backend/tests/test_webapp.py
"""

import os
import re
import sys
import time
import uuid
from datetime import datetime

from playwright.sync_api import sync_playwright, expect

FRONTEND = os.getenv("FRONTEND_URL", "http://localhost:5173")
BACKEND = os.getenv("BACKEND_URL", "http://localhost:8000")
SHOTS = os.getenv("SHOT_DIR", "C:/Users/vreya/AppData/Local/Temp/lumen-shots")
os.makedirs(SHOTS, exist_ok=True)

PASS, FAIL = [], []


def check(name, condition, detail=""):
    if condition:
        PASS.append(name)
        print(f"  PASS  {name}")
    else:
        FAIL.append(f"{name} :: {detail}")
        print(f"  FAIL  {name}  {detail}")


def shot(page, name):
    path = os.path.join(SHOTS, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    return path


def api(method, path, token=None, payload=None):
    import httpx
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = httpx.request(method, f"{BACKEND}{path}", headers=headers, json=payload, timeout=30.0)
    return r


def main():
    stamp = uuid.uuid4().hex[:8]
    username = f"pw_{stamp}"
    email = f"{username}@example.org"
    password = "Lumen!2345"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})

        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"PAGEERROR: {e}"))

        # Capture every response the app gets back, so a failing request can
        # be diagnosed rather than guessed at.
        api_log = []

        def log_response(response):
            if "/syllabus/subjects" in response.url or "/auth/profile" in response.url:
                try:
                    body = response.text()[:160]
                except Exception:
                    body = "<unreadable>"
                api_log.append((response.request.method, response.url.split(":8000")[-1],
                                response.status, body))

        page.on("response", log_response)

        # ── 1. Auth page ──────────────────────────────────────────────────────
        print("\n[1] Auth page")
        page.goto(f"{FRONTEND}/auth")
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("h1", timeout=20000)

        check("title carries the product name", page.title().startswith("Lumen"), page.title())
        check("h1 shows 'Lumen'", page.locator("h1").inner_text().strip() == "Lumen",
              page.locator("h1").inner_text())
        body = page.inner_text("body")
        for banned in ["JEE", "NEET", "Exam Target", "Target Exam", "Exam Date"]:
            check(f"auth page has no '{banned}'", banned.lower() not in body.lower(), banned)
        shot(page, "01-auth")

        # ── 2. Sign up form ──────────────────────────────────────────────────
        print("\n[2] Sign up form")
        page.get_by_role("button", name="Sign Up").click()
        page.wait_for_selector("select[name=grade_level]", timeout=15000)

        levels = page.eval_on_selector_all(
            "select[name=grade_level] option",
            "els => els.map(e => e.value)",
        )
        check("grade_level has neutral levels", levels == [
            "Middle School", "High School", "Diploma", "Undergraduate",
            "Postgraduate", "Self-directed",
        ], str(levels))

        check("no exam_track select", page.locator("select[name=exam_track]").count() == 0)

        # Add three subject chips, typing like a human.
        # NOTE: the selectors are exact — several inputs start with "e.g.",
        # including the username field.
        chip_input = page.get_by_placeholder("e.g. Organic Chemistry")
        for subject in ["Astronomy", "Poetics", "Statistics"]:
            chip_input.fill(subject)
            page.wait_for_timeout(250)
            page.get_by_role("button", name="Add", exact=True).click()
            page.wait_for_timeout(300)

        page.locator("input[name=academic_goal]").fill("Build a solid foundation")
        page.locator("input[name=username]").fill(username)
        page.locator("input[name=email]").fill(email)
        page.locator("input[name=password]").fill(password)
        page.wait_for_timeout(300)
        shot(page, "02-signup-filled")

        # ── 3. Register ──────────────────────────────────────────────────────
        print("\n[3] Register")
        page.get_by_role("button", name=re.compile("Initialize Account", re.I)).click()
        page.wait_for_url(lambda u: u.rstrip("/").endswith(":5173"), timeout=30000)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(3500)

        check("redirected to dashboard", page.url.rstrip("/").endswith(":5173"), page.url)
        check("onboarding modal opened",
              page.get_by_text("Configure Your AI Companion").count() > 0)

        # ── 4. Onboarding: chips → tracker ───────────────────────────────────
        print("\n[4] Onboarding")
        onboard_chip = page.get_by_placeholder("e.g. Thermodynamics")
        for subject in ["Astronomy", "Poetics", "Statistics"]:
            onboard_chip.fill(subject)
            page.wait_for_timeout(250)
            page.get_by_role("button", name="Add", exact=True).click()
            page.wait_for_timeout(300)

        page.get_by_text("Configure Your AI Companion").wait_for(timeout=10000)
        page.get_by_role("button", name=re.compile("Build My Course Tracker", re.I)).click()
        page.wait_for_timeout(6000)

        check("onboarding modal closed",
              page.get_by_text("Configure Your AI Companion").count() == 0)

        print("    network during onboarding:")
        for method, path, status, body in api_log:
            print(f"      {method} {path} -> {status}  {body}")

        # Verify against the API that ALL subjects were persisted.
        token = page.evaluate("localStorage.getItem('access_token')")
        roadmap = api("GET", "/syllabus/my-roadmap", token=token).json()["data"]
        names = sorted(s["subject_name"] for s in (roadmap or {}).get("subjects", []))
        check("all 3 subjects persisted (no lost update)", names == ["Astronomy", "Poetics", "Statistics"],
              str(names))

        me = api("GET", "/auth/me", token=token).json()
        check("profile has grade_level", me.get("grade_level") == "Undergraduate", str(me.get("grade_level")))
        check("profile has no exam_track", "exam_track" not in me)
        check("profile has academic_goal", me.get("academic_goal") == "Build a solid foundation")

        # ── 5. Dashboard ─────────────────────────────────────────────────────
        print("\n[5] Dashboard")
        dash_text = page.inner_text("body")
        for banned in ["JEE", "NEET", "Current Rank", "PYQ", "Mock Test", "Exam Track"]:
            check(f"dashboard has no '{banned}'", banned.lower() not in dash_text.lower(), banned)
        check("shows 'Study Rating'", "study rating" in dash_text.lower(), dash_text[:150])
        check("shows learner subjects", "Astronomy" in dash_text and "Poetics" in dash_text)
        check("shows 'Resource Library'", "Resource Library" in dash_text)
        shot(page, "03-dashboard")

        # ── 6. Sidebar navigation ────────────────────────────────────────────
        print("\n[6] Sidebar")
        sidebar = page.locator("aside").inner_text()
        check("sidebar has 'Library'", "Library" in sidebar, sidebar[:120])
        check("sidebar has 'Practice Test'", "Practice Test" in sidebar)
        check("sidebar has no 'Vault'", "Vault" not in sidebar)
        check("sidebar has no 'Proctoring'", "Proctoring" not in sidebar)
        check("sidebar has no 'Rank'", "Rank" not in sidebar)

        # ── 7. Course tracker CRUD ───────────────────────────────────────────
        print("\n[7] Course tracker")
        subject_input = page.get_by_placeholder("Add a subject (e.g. Organic Chemistry)")
        subject_input.fill("Cartography")
        page.wait_for_timeout(300)
        subject_input.press("Enter")
        page.wait_for_timeout(2000)

        roadmap = api("GET", "/syllabus/my-roadmap", token=token).json()["data"]
        names = sorted(s["subject_name"] for s in roadmap.get("subjects", []))
        check("subject added via UI", "Cartography" in names, str(names))

        # Add module + topic through the API, then verify the UI shows them.
        api("POST", "/syllabus/subjects/Cartography/modules", token=token,
            payload={"module_name": "Projections"})
        api("POST", "/syllabus/subjects/Cartography/modules/Projections/topics", token=token,
            payload={"topic_name": "Mercator Projection"})
        page.reload()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(4000)

        tracker_text = page.inner_text("body")
        check("tracker shows subject", "Cartography" in tracker_text)
        # Module names are rendered in upper case by the CSS, so compare loosely.
        check("tracker shows module", "projections" in tracker_text.lower(), tracker_text[-300:])
        check("tracker shows topic", "mercator projection" in tracker_text.lower())
        shot(page, "04-tracker")

        # Click the topic to complete it.
        # Click the topic in the tracker. A precise role selector is used
        # because the daily planner may also mention the topic in a task title.
        topic_button = page.get_by_role("button", name="Mercator Projection", exact=True).first
        check("topic row is a button", topic_button.count() > 0)
        topic_button.click()
        page.wait_for_timeout(3000)
        roadmap = api("GET", "/syllabus/my-roadmap", token=token).json()["data"]
        completed = False
        for s in roadmap.get("subjects", []):
            for m in s.get("modules", []):
                for t in m.get("topics", []):
                    if t["topic_name"] == "Mercator Projection" and t.get("is_completed"):
                        completed = True
        check("topic marked complete from the UI", completed)

        # ── 8. Resource library upload ───────────────────────────────────────
        print("\n[8] Resource library upload")
        fixture = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "fixtures", "sample_upload.pdf")
        page.goto(f"{FRONTEND}/library")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2500)

        file_input = page.locator('input[type="file"]').first
        check("library has a file input", file_input.count() > 0)
        file_input.set_input_files(fixture)
        page.wait_for_timeout(1200)

        upload_btn = page.get_by_role("button", name=re.compile("upload|process|add", re.I)).first
        if upload_btn.count():
            upload_btn.click()
        page.wait_for_timeout(25000)

        docs = api("GET", "/library/documents", token=token).json()
        check("document was uploaded", len(docs) >= 1, str(docs))
        if docs:
            check("document has a subject", bool(docs[0].get("subject")), str(docs[0]))
        shot(page, "11-library-upload")

        # ── 9. Parallel subject creation (the concurrency fix) ───────────────
        print("\n[9] Concurrency")
        import concurrent.futures
        names_to_add = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            list(ex.map(
                lambda n: api("POST", "/syllabus/subjects", token=token, payload={"subject_name": n}),
                names_to_add,
            ))
        roadmap = api("GET", "/syllabus/my-roadmap", token=token).json()["data"]
        names = {s["subject_name"] for s in roadmap.get("subjects", [])}
        missing = [n for n in names_to_add if n not in names]
        check("5 parallel subject creates all persisted", not missing, f"missing: {missing}")

        # ── 9. Other routes ──────────────────────────────────────────────────
        for route, marker, shot_name in [
            ("/library", "Active Sources", "05-library"),
            ("/quiz", "Forge Your", "06-quiz"),
            ("/mentor", "Mentor Command Center", "07-mentor"),
            ("/revision", "Revision Engine", "08-revision"),
            ("/practice", "Focus Mode", "09-practice"),
            ("/arena", "Finding Opponent", "10-arena"),
        ]:
            print(f"    route {route}")
            before = len(console_errors)
            page.goto(f"{FRONTEND}{route}")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(4000)
            text = page.inner_text("body")
            check(f"{route} renders", marker.lower() in text.lower(), text[:110].replace("\n", " | "))
            new_errors = [e for e in console_errors[before:] if "face-api" not in e.lower()
                          and "webgazer" not in e.lower()]
            check(f"{route} has no console errors", not new_errors, str(new_errors[:2]))
            shot(page, shot_name)

        # ── 10. Legacy redirects ─────────────────────────────────────────────
        print("\n[10] Legacy redirects")
        page.goto(f"{FRONTEND}/vault")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2500)
        check("/vault redirects to /library", "/library" in page.url, page.url)

        page.goto(f"{FRONTEND}/proctored")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2500)
        check("/proctored redirects to /practice", "/practice" in page.url, page.url)

        # ── 11. Console health ───────────────────────────────────────────────
        print("\n[11] Console")
        ignorable = ("face-api", "webgazer", "mediapipe", "FaceDetection", "Download the React DevTools",
                     "ERR_NETWORK_IO_SUSPENDED", "ERR_ABORTED", "Network Error")
        real = [e for e in console_errors if not any(i.lower() in e.lower() for i in ignorable)]
        check("no unexpected console errors overall", not real, str(real[:3]))

        browser.close()

    # ── Summary ────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"PASSED: {len(PASS)}   FAILED: {len(FAIL)}")
    for f in FAIL:
        print("  FAILED:", f)
    print(f"screenshots: {SHOTS}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
