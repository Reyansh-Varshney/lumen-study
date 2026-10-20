import bcrypt
import jwt
from datetime import datetime, timedelta
from fastapi import WebSocketException, Query, status
from app.core.config import settings

def hash_password(password: str) -> str:
    # Bcrypt has a 72-byte limit. We encode to utf-8 and hash.
    # We use bcrypt directly because passlib has compatibility issues with bcrypt 4.0+
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'), 
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

async def get_current_user_ws(token: str = Query(...)) -> str:
    """
    Authenticate a WebSocket connection using a JWT from the query parameter.
    Returns the user_id if valid, else raises a WebSocketException.
    """
    try:
        payload = jwt.decode(
            token, 
            settings.JWT_SECRET_KEY, 
            algorithms=[settings.ALGORITHM]
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
        return user_id
    except jwt.PyJWTError:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
