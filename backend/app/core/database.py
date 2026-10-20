from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
import logging

class Database:
    client: AsyncIOMotorClient = None
    db = None

db_instance = Database()

async def connect_to_mongo():
    db_instance.client = AsyncIOMotorClient(settings.MONGO_URI)
    db_instance.db = db_instance.client.get_database(settings.DATABASE_NAME)
    logging.info(f"Connected to MongoDB: {settings.DATABASE_NAME}")

async def close_mongo_connection():
    if db_instance.client:
        db_instance.client.close()
        logging.info("Disconnected from MongoDB")

def get_database():
    if db_instance.db is None:
        raise RuntimeError("Database not initialized")
    return db_instance.db
