from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from app.models.user import UserCreate, Token, UserProfileUpdate
from app.core.database import get_database
from app.core.security import hash_password, verify_password, create_access_token
from app.core.dependencies import get_current_user
from bson import ObjectId

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _clean_subjects(subjects) -> list:
    """Normalise a subject list: strip blanks, drop duplicates, keep order."""
    cleaned = []
    for subject in subjects or []:
        if not subject:
            continue
        name = str(subject).strip()
        if name and name not in cleaned:
            cleaned.append(name)
    return cleaned


@router.post("/register", response_model=dict)
async def register(user: UserCreate):
    db = get_database()

    # Check if email exists
    existing_user = await db.users.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Check if username exists
    existing_username = await db.users.find_one({"username": user.username})
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already taken")

    user_dict = {
        "username": user.username,
        "email": user.email,
        "hashed_password": hash_password(user.password),
        "role": "student",
        "elo_rating": 1200,
        "total_xp": 0,
        "grade_level": user.grade_level,
        "academic_goal": user.academic_goal,
        "active_subjects": _clean_subjects(user.active_subjects),
    }

    result = await db.users.insert_one(user_dict)
    return {"message": "User registered successfully", "user_id": str(result.inserted_id)}


@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    db = get_database()
    user = await db.users.find_one({"email": form_data.username})  # Using email as username for login

    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={"sub": str(user["_id"]), "role": user["role"]}
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    db = get_database()
    user = await db.users.find_one({"_id": ObjectId(current_user["user_id"])})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user_id": str(user["_id"]),
        "username": user.get("username", "Learner"),
        "email": user.get("email"),
        "role": user.get("role", "student"),
        "elo_rating": user.get("elo_rating", 1200),
        "total_xp": user.get("total_xp", 0),
        "grade_level": user.get("grade_level"),
        "academic_goal": user.get("academic_goal"),
        "active_subjects": user.get("active_subjects", []),
        "target_date": user.get("target_date"),
        "master_syllabus_id": user.get("master_syllabus_id"),
    }


@router.patch("/profile")
async def update_profile(
    payload: UserProfileUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Let a learner refine their level, goal, subjects and target date at any time."""
    db = get_database()
    user_id = current_user["user_id"]

    update_fields = {}
    if payload.grade_level is not None:
        update_fields["grade_level"] = payload.grade_level
    if payload.academic_goal is not None:
        update_fields["academic_goal"] = payload.academic_goal
    if payload.active_subjects is not None:
        update_fields["active_subjects"] = _clean_subjects(payload.active_subjects)
    if payload.target_date is not None:
        update_fields["target_date"] = payload.target_date

    if not update_fields:
        return {"message": "Nothing to update"}

    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update_fields})

    updated = await db.users.find_one({"_id": ObjectId(user_id)})
    return {
        "message": "Profile updated",
        "profile": {
            "grade_level": updated.get("grade_level"),
            "academic_goal": updated.get("academic_goal"),
            "active_subjects": updated.get("active_subjects", []),
            "target_date": updated.get("target_date"),
        },
    }
