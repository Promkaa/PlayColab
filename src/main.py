from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any, Set
from datetime import datetime
import json
import os
import requests
from pathlib import Path
import asyncio

# Импортируем парсер
from vk_parser import vk_parser

app = FastAPI(title="VK Music Player API", version="1.0.0")

# CORS настройки
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://192.168.31.144:3000",
        "http://192.168.31.*:3000",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== МОДЕЛИ ДАННЫХ ====================

class Track(BaseModel):
    id: Optional[str] = None
    vk_id: Optional[str] = None
    artist: str = "Unknown"
    title: str = "Unknown"
    duration: Optional[int] = 0
    url: Optional[str] = None
    cover_url: Optional[str] = None
    cover_small: Optional[str] = None
    cover_big: Optional[str] = None
    added_by: Optional[str] = None
    added_by_id: Optional[str] = None
    added_at: Optional[str] = None
    position: Optional[int] = None

class Participant(BaseModel):
    id: str
    name: str
    isCreator: bool = False
    joined_at: Optional[str] = None

class Room(BaseModel):
    id: str
    name: str
    createdAt: str
    creator: str
    creator_id: Optional[str] = None
    participants: List[Participant] = []
    tracks: List[Track] = []
    scenario: str = "withVoting"
    currentTrack: Optional[Track] = None
    currentTrackIndex: int = -1
    isPlaying: bool = False
    currentTime: float = 0
    roomIsShuffled: bool = False
    roomRepeatMode: str = "off"

class ChatMessage(BaseModel):
    room_id: str
    user_id: str
    user_name: str
    message: str
    timestamp: str

class VotingSession(BaseModel):
    id: str
    room_id: str
    track: Track
    proposed_by: str
    proposed_by_id: str
    proposed_at: str
    status: str = "active"
    votes_yes: List[str] = []
    votes_no: List[str] = []
    voters: List[str] = []
    
    class Config:
        arbitrary_types_allowed = True

# ==================== ХРАНИЛИЩЕ ДАННЫХ ====================

class DataStore:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}
        self.user_sessions: Dict[str, Dict] = {}
        self.chat_messages: Dict[str, List[ChatMessage]] = {}
        self.voting_sessions: Dict[str, VotingSession] = {}
        self.room_voting: Dict[str, str] = {}
        self.voting_tasks: Dict[str, asyncio.Task] = {}  # Отдельное хранилище для задач
        self.user_data_dir = Path(__file__).parent.parent / "user_data"
        self.user_data_dir.mkdir(exist_ok=True)
        self.load_rooms_from_file()
    
    def load_rooms_from_file(self):
        rooms_file = Path(__file__).parent.parent / "rooms_backup.json"
        if rooms_file.exists():
            try:
                with open(rooms_file, 'r', encoding='utf-8') as f:
                    rooms_data = json.load(f)
                    for room_data in rooms_data:
                        room = Room(**room_data)
                        self.rooms[room.id] = room
                print(f"✅ Загружено {len(self.rooms)} комнат")
            except Exception as e:
                print(f"❌ Ошибка загрузки комнат: {e}")
    
    def save_rooms_to_file(self):
        try:
            rooms_file = Path(__file__).parent.parent / "rooms_backup.json"
            rooms_data = [room.dict() for room in self.rooms.values()]
            with open(rooms_file, 'w', encoding='utf-8') as f:
                json.dump(rooms_data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"❌ Ошибка сохранения комнат: {e}")
            return False
    
    def get_user_music_file(self, user_id: str) -> Path:
        """Получение пути к файлу музыки пользователя"""
        return self.user_data_dir / f"user_{user_id}_music.json"
    
    def get_user_music_data(self, user_id: str) -> Dict[str, Any]:
        """Получение музыкальных данных пользователя"""
        user_file = self.get_user_music_file(user_id)
        if user_file.exists():
            try:
                with open(user_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return {"playlists": [], "exported_at": datetime.now().isoformat(), "user_id": user_id}
    
    def save_user_music_data(self, user_id: str, data: Dict[str, Any]):
        """Сохранение музыкальных данных пользователя"""
        user_file = self.get_user_music_file(user_id)
        with open(user_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    
    def create_voting_session(self, room_id: str, track: Track, user_id: str, user_name: str) -> VotingSession:
        """Создание новой сессии голосования"""
        session_id = f"vote_{room_id}_{int(datetime.now().timestamp() * 1000)}"
        
        voting_session = VotingSession(
            id=session_id,
            room_id=room_id,
            track=track,
            proposed_by=user_name,
            proposed_by_id=user_id,
            proposed_at=datetime.now().isoformat(),
            status="active",
            votes_yes=[],
            votes_no=[],
            voters=[]
        )
        
        self.voting_sessions[session_id] = voting_session
        self.room_voting[room_id] = session_id
        return voting_session
    
    def set_voting_task(self, session_id: str, task: asyncio.Task):
        """Сохранить задачу авто-завершения"""
        self.voting_tasks[session_id] = task
    
    def cancel_voting_task(self, session_id: str):
        """Отменить задачу авто-завершения"""
        if session_id in self.voting_tasks:
            if not self.voting_tasks[session_id].done():
                self.voting_tasks[session_id].cancel()
            del self.voting_tasks[session_id]

    def cast_vote_on_session(self, session_id: str, user_id: str, vote: str) -> Dict[str, Any]:
        """Голосование в сессии"""
        if session_id not in self.voting_sessions:
            return None
        
        session = self.voting_sessions[session_id]
        
        if session.status != "active":
            return {"error": "Voting session is not active"}
        
        if user_id in session.voters:
            return {"error": "User already voted"}
        
        session.voters.append(user_id)
        if vote == "yes":
            session.votes_yes.append(user_id)
        else:
            session.votes_no.append(user_id)
        
        return {
            "session_id": session_id,
            "votes_yes": len(session.votes_yes),
            "votes_no": len(session.votes_no),
            "total_voted": len(session.voters)
        }

    def get_voting_session(self, room_id: str):
        """Получение активной сессии голосования для комнаты"""
        session_id = self.room_voting.get(room_id)
        if session_id and session_id in self.voting_sessions:
            session = self.voting_sessions[session_id]
            if session.status == "active":
                return session
        return None

    def complete_voting(self, room_id: str) -> Dict[str, Any]:
        """Завершение голосования и принятие решения"""
        session_id = self.room_voting.get(room_id)
        if not session_id or session_id not in self.voting_sessions:
            return None
        
        session = self.voting_sessions[session_id]
        
        if session.status != "active":
            return None
        
        # Отменяем задачу автозавершения если есть
        self.cancel_voting_task(session_id)
        
        total_votes = len(session.voters)
        yes_votes = len(session.votes_yes)
        no_votes = len(session.votes_no)
        
        # Трек добавляется только если ЗА > ПРОТИВ
        accepted = yes_votes > no_votes
        
        session.status = "completed"
        
        if session_id in self.room_voting:
            del self.room_voting[room_id]
        
        return {
            "accepted": accepted,
            "yes_votes": yes_votes,
            "no_votes": no_votes,
            "total_votes": total_votes,
            "session": session
        }
    
    def has_all_voted(self, room_id: str) -> bool:
        """Проверка, проголосовали ли все участники"""
        session = self.get_voting_session(room_id)
        if not session:
            return False
        
        room = self.rooms.get(room_id)
        if not room:
            return False
        
        total_participants = len(room.participants)
        total_voted = len(session.voters)
        
        return total_voted >= total_participants

datastore = DataStore()

# ==================== WEB SOCKET МЕНЕДЖЕР ====================

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.user_rooms: Dict[str, str] = {}
    
    async def connect(self, room_id: str, user_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = set()
        self.active_connections[room_id].add(websocket)
        self.user_rooms[user_id] = room_id
        
    def disconnect(self, room_id: str, user_id: str, websocket: WebSocket):
        if room_id in self.active_connections:
            self.active_connections[room_id].discard(websocket)
        if user_id in self.user_rooms:
            del self.user_rooms[user_id]
    
    async def broadcast_to_room(self, room_id: str, message: dict):
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                try:
                    await connection.send_json(message)
                except:
                    pass

manager = ConnectionManager()

# ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

def normalize_track_data(track_data: Dict[str, Any]) -> Track:
    """Нормализует данные трека из любого источника"""
    track_id = track_data.get('id') or track_data.get('vk_id')
    if track_id is not None:
        track_id = str(track_id)
    else:
        track_id = str(int(datetime.now().timestamp() * 1000))
    
    vk_id = track_data.get('vk_id')
    if vk_id is not None:
        vk_id = str(vk_id)
    
    duration = track_data.get('duration', 0)
    if duration is not None:
        try:
            duration = int(duration)
        except:
            duration = 0
    
    return Track(
        id=track_id,
        vk_id=vk_id,
        artist=str(track_data.get('artist', 'Unknown Artist')),
        title=str(track_data.get('title', 'Unknown Title')),
        duration=duration,
        url=str(track_data.get('url')) if track_data.get('url') else None,
        cover_url=str(track_data.get('cover_url')) if track_data.get('cover_url') else None,
        cover_small=str(track_data.get('cover_small')) if track_data.get('cover_small') else None,
        cover_big=str(track_data.get('cover_big')) if track_data.get('cover_big') else None,
        added_by=str(track_data.get('added_by')) if track_data.get('added_by') else None,
        added_by_id=str(track_data.get('added_by_id')) if track_data.get('added_by_id') else None,
        added_at=str(track_data.get('added_at', datetime.now().isoformat()))
    )

async def auto_complete_voting(room_id: str, session_id: str):
    """Автоматическое завершение голосования через 60 секунд"""
    await asyncio.sleep(60)
    
    # Проверяем, что сессия все еще активна и не завершена досрочно
    session = datastore.get_voting_session(room_id)
    if session and session.id == session_id and session.status == "active":
        result = datastore.complete_voting(room_id)
        if result:
            room = datastore.rooms.get(room_id)
            if room and result["accepted"]:
                room.tracks.append(result["session"].track)
                datastore.rooms[room_id] = room
                datastore.save_rooms_to_file()
            
            await manager.broadcast_to_room(room_id, {
                "type": "voting_completed",
                "accepted": result["accepted"],
                "track": result["session"].track.dict(),
                "yes_votes": result["yes_votes"],
                "no_votes": result["no_votes"],
                "total_votes": result["total_votes"],
                "message": f"⏰ Время голосования истекло! Трек {'добавлен' if result['accepted'] else 'НЕ добавлен'}. За: {result['yes_votes']}, Против: {result['no_votes']}"
            })

async def check_and_complete_voting(room_id: str, session_id: str):
    """Проверка и завершение голосования если все проголосовали"""
    if datastore.has_all_voted(room_id):
        result = datastore.complete_voting(room_id)
        if result:
            room = datastore.rooms.get(room_id)
            if room and result["accepted"]:
                room.tracks.append(result["session"].track)
                datastore.rooms[room_id] = room
                datastore.save_rooms_to_file()
            
            await manager.broadcast_to_room(room_id, {
                "type": "voting_completed",
                "accepted": result["accepted"],
                "track": result["session"].track.dict(),
                "yes_votes": result["yes_votes"],
                "no_votes": result["no_votes"],
                "total_votes": result["total_votes"],
                "message": f"✅ Голосование завершено! Все участники проголосовали. Трек {'добавлен' if result['accepted'] else 'НЕ добавлен'}. За: {result['yes_votes']}, Против: {result['no_votes']}"
            })
            return True
    return False

# ==================== ОСНОВНЫЕ ENDPOINTS ====================

@app.get("/")
async def root():
    return {"message": "VK Music Player API", "status": "running"}

# -------------------- АВТОРИЗАЦИЯ --------------------
@app.post("/api/verify-token")
async def verify_vk_token(token_data: Dict[str, str]):
    token = token_data.get("token")
    if not token:
        return {"valid": False, "error": "Token required"}
    
    try:
        response = requests.get(
            f"https://api.vk.com/method/users.get",
            params={"access_token": token, "v": "5.131"},
            timeout=10
        )
        data = response.json()
        
        if "error" in data:
            return {"valid": False, "error": data["error"].get("error_msg", "Invalid token")}
        
        if "response" in data and len(data["response"]) > 0:
            user = data["response"][0]
            user_id = str(user.get("id"))
            
            # Создаем персональный файл если его нет
            user_music = datastore.get_user_music_data(user_id)
            
            return {
                "valid": True,
                "user": {
                    "id": user_id,
                    "first_name": user.get("first_name"),
                    "last_name": user.get("last_name"),
                    "full_name": f"{user.get('first_name', '')} {user.get('last_name', '')}"
                }
            }
        return {"valid": False, "error": "Unknown error"}
    except Exception as e:
        return {"valid": False, "error": str(e)}

# -------------------- МУЗЫКА И ПАРСИНГ (ПЕРСОНАЛЬНЫЙ) --------------------
@app.get("/api/music-data")
async def get_music_data(user_id: str):
    """Получение музыкальных данных пользователя"""
    return datastore.get_user_music_data(user_id)

@app.get("/api/music-stats")
async def get_music_stats(user_id: str):
    """Получение статистики музыки пользователя"""
    data = datastore.get_user_music_data(user_id)
    total_tracks = 0
    playlists_stats = []
    
    for playlist in data.get('playlists', []):
        tracks_count = len(playlist.get('tracks', []))
        total_tracks += tracks_count
        playlists_stats.append({
            'id': playlist.get('id'),
            'title': playlist.get('title'),
            'tracks_count': tracks_count,
            'is_main': playlist.get('is_main', False)
        })
    
    return {
        'total_tracks': total_tracks,
        'total_playlists': len(data.get('playlists', [])),
        'playlists': playlists_stats
    }

@app.post("/api/parse-music")
async def parse_music(token_data: Dict[str, str]):
    token = token_data.get("token")
    user_id = token_data.get("user_id")
    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    if not user_id:
        raise HTTPException(status_code=400, detail="User ID required")
    
    # Передаем user_id в парсер для сохранения в персональный файл
    result = vk_parser.parse_user_music(token, user_id)
    
    if not result['success']:
        raise HTTPException(status_code=400, detail=result.get('error', 'Unknown error'))
    
    return result

@app.get("/api/parse-status")
async def get_parse_status():
    return vk_parser.get_parse_status()

@app.post("/api/sync-playlist/{playlist_id}")
async def sync_playlist(playlist_id: str, token_data: Dict[str, str]):
    token = token_data.get("token")
    user_id = token_data.get("user_id")
    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    if not user_id:
        raise HTTPException(status_code=400, detail="User ID required")
    
    result = vk_parser.sync_playlist(token, playlist_id, user_id)
    
    if not result['success']:
        raise HTTPException(status_code=400, detail=result.get('error', 'Unknown error'))
    
    return result

# -------------------- КОМНАТЫ --------------------
@app.get("/api/rooms")
async def get_rooms():
    return list(datastore.rooms.values())

@app.post("/api/rooms")
async def create_room(room: Room):
    if room.id in datastore.rooms:
        raise HTTPException(status_code=400, detail="Room already exists")
    
    datastore.rooms[room.id] = room
    datastore.save_rooms_to_file()
    return {"message": "Room created", "room": room}

@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    return datastore.rooms[room_id]

@app.delete("/api/rooms/{room_id}")
async def delete_room(room_id: str):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    deleted_room = datastore.rooms.pop(room_id)
    datastore.save_rooms_to_file()
    return {"message": f"Room '{deleted_room.name}' deleted"}

# -------------------- УЧАСТНИКИ --------------------
@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: str, user_data: Dict[str, str]):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    user_id = user_data.get("user_id")
    user_name = user_data.get("user_name")
    
    if not user_id or not user_name:
        raise HTTPException(status_code=400, detail="User ID and name required")
    
    for participant in room.participants:
        if participant.id == user_id:
            return {"message": "User already in room", "room": room}
    
    new_participant = Participant(
        id=user_id,
        name=user_name,
        isCreator=False,
        joined_at=datetime.now().isoformat()
    )
    room.participants.append(new_participant)
    
    datastore.rooms[room_id] = room
    datastore.save_rooms_to_file()
    
    await manager.broadcast_to_room(room_id, {
        "type": "user_joined",
        "user": new_participant.dict(),
        "participants_count": len(room.participants)
    })
    
    return {"message": f"User {user_name} joined room", "room": room}

@app.post("/api/rooms/{room_id}/leave")
async def leave_room(room_id: str, user_data: Dict[str, str]):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    user_id = user_data.get("user_id")
    
    if not user_id:
        raise HTTPException(status_code=400, detail="User ID required")
    
    leaving_user = None
    for p in room.participants:
        if p.id == user_id:
            leaving_user = p
            break
    
    room.participants = [p for p in room.participants if p.id != user_id]
    
    if len(room.participants) == 0:
        del datastore.rooms[room_id]
        datastore.save_rooms_to_file()
        
        await manager.broadcast_to_room(room_id, {
            "type": "room_closed",
            "message": "Room is empty and has been closed"
        })
        
        return {"message": "Room deleted", "room_deleted": True}
    
    datastore.rooms[room_id] = room
    datastore.save_rooms_to_file()
    
    await manager.broadcast_to_room(room_id, {
        "type": "user_left",
        "user_id": user_id,
        "user_name": leaving_user.name if leaving_user else user_id,
        "participants_count": len(room.participants)
    })
    
    return {"message": "User left room", "room": room}

# -------------------- ТРЕКИ В КОМНАТЕ --------------------
@app.post("/api/rooms/{room_id}/propose-track")
async def propose_track(room_id: str, request: Request):
    """Предложение трека для голосования"""
    data = await request.json()
    track_data = data.get("track", {})
    user_id = data.get("user_id")
    user_name = data.get("user_name")
    
    print(f"📥 Propose track for room {room_id}: {track_data}")
    
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    
    if room.scenario != "withVoting":
        track = normalize_track_data(track_data)
        track.added_by = user_name
        track.added_by_id = user_id
        track.added_at = datetime.now().isoformat()
        room.tracks.append(track)
        datastore.rooms[room_id] = room
        datastore.save_rooms_to_file()
        
        await manager.broadcast_to_room(room_id, {
            "type": "track_added_direct",
            "track": track.dict(),
            "added_by": user_name
        })
        
        return {"message": "Track added directly", "track": track}
    
    existing_session = datastore.get_voting_session(room_id)
    if existing_session:
        raise HTTPException(status_code=400, detail="There is already an active voting session in this room")
    
    track_id = str(track_data.get('id') or track_data.get('vk_id'))
    for existing in room.tracks:
        if existing.id == track_id or existing.vk_id == track_id:
            raise HTTPException(status_code=400, detail="Track already in room")
    
    new_track = normalize_track_data(track_data)
    
    voting_session = datastore.create_voting_session(room_id, new_track, user_id, user_name)
    
    # Запускаем таймер автоматического завершения
    auto_task = asyncio.create_task(auto_complete_voting(room_id, voting_session.id))
    datastore.set_voting_task(voting_session.id, auto_task)
    
    await manager.broadcast_to_room(room_id, {
        "type": "voting_started",
        "session_id": voting_session.id,
        "track": new_track.dict(),
        "proposed_by": user_name,
        "proposed_by_id": user_id,
        "total_participants": len(room.participants)
    })
    
    return {"message": "Voting session started", "session_id": voting_session.id, "track": new_track}

@app.post("/api/rooms/{room_id}/vote")
async def cast_vote(room_id: str, vote_data: Dict[str, Any]):
    """Голосование за трек в комнате"""
    print(f"📥 Vote in room {room_id}: {vote_data}")
    
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    session = datastore.get_voting_session(room_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active voting session")
    
    user_id = vote_data.get("user_id")
    vote_value = vote_data.get("vote")
    
    if not user_id or not vote_value:
        raise HTTPException(status_code=400, detail="user_id and vote are required")
    
    if vote_value not in ["yes", "no"]:
        raise HTTPException(status_code=400, detail="Vote must be 'yes' or 'no'")
    
    result = datastore.cast_vote_on_session(session.id, user_id, vote_value)
    
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    
    await manager.broadcast_to_room(room_id, {
        "type": "vote_update",
        "session_id": session.id,
        "votes_yes": result["votes_yes"],
        "votes_no": result["votes_no"],
        "total_voted": result["total_voted"],
        "user_id": user_id,
        "vote": vote_value
    })
    
    # Проверяем, проголосовали ли все участники
    all_voted = await check_and_complete_voting(room_id, session.id)
    
    return {"message": "Vote cast", "votes": result, "all_voted": all_voted}

@app.post("/api/rooms/{room_id}/tracks")
async def add_track_to_room(room_id: str, track_data: Dict[str, Any]):
    """Добавление трека в комнату (без голосования)"""
    print(f"📥 Add track to room {room_id}: {track_data}")
    
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    
    new_track = normalize_track_data(track_data)
    
    for existing in room.tracks:
        if existing.id == new_track.id or existing.vk_id == new_track.vk_id:
            raise HTTPException(status_code=400, detail="Track already in room")
    
    room.tracks.append(new_track)
    datastore.rooms[room_id] = room
    datastore.save_rooms_to_file()
    
    await manager.broadcast_to_room(room_id, {
        "type": "track_added",
        "track": new_track.dict(),
        "tracks_count": len(room.tracks)
    })
    
    return {"message": "Track added to room", "track": new_track}

@app.delete("/api/rooms/{room_id}/tracks/{track_id}")
async def remove_track_from_room(room_id: str, track_id: str, user_id: str):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    
    track_to_remove = None
    for i, track in enumerate(room.tracks):
        if track.id == track_id or track.vk_id == track_id:
            track_to_remove = room.tracks.pop(i)
            break
    
    if not track_to_remove:
        raise HTTPException(status_code=404, detail="Track not found")
    
    is_creator = any(p.id == user_id and p.isCreator for p in room.participants)
    if track_to_remove.added_by != user_id and track_to_remove.added_by_id != user_id and not is_creator:
        raise HTTPException(status_code=403, detail="No permission to remove this track")
    
    datastore.rooms[room_id] = room
    datastore.save_rooms_to_file()
    
    await manager.broadcast_to_room(room_id, {
        "type": "track_removed",
        "track_id": track_id,
        "track_title": track_to_remove.title,
        "removed_by": user_id,
        "tracks_count": len(room.tracks)
    })
    
    return {"message": f"Track '{track_to_remove.title}' removed from room"}

# -------------------- УПРАВЛЕНИЕ ПЛЕЕРОМ --------------------
@app.post("/api/rooms/{room_id}/player/play")
async def play_track(room_id: str, play_data: Dict[str, Any]):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    track_data = play_data.get("track")
    index = play_data.get("index", -1)
    user_id = play_data.get("userId")
    
    if track_data:
        track = normalize_track_data(track_data)
        room.currentTrack = track
        room.currentTrackIndex = index
        room.isPlaying = True
        room.currentTime = 0
        
        datastore.rooms[room_id] = room
        datastore.save_rooms_to_file()
        
        await manager.broadcast_to_room(room_id, {
            "type": "player_play",
            "track": track.dict(),
            "index": index,
            "currentTime": 0,
            "userId": user_id
        })
    
    return {"message": "Playback started"}

@app.post("/api/rooms/{room_id}/player/pause")
async def pause_track(room_id: str, pause_data: Dict[str, str]):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    user_id = pause_data.get("userId")
    
    room.isPlaying = False
    datastore.rooms[room_id] = room
    datastore.save_rooms_to_file()
    
    await manager.broadcast_to_room(room_id, {
        "type": "player_pause",
        "userId": user_id,
        "currentTime": room.currentTime
    })
    
    return {"message": "Playback paused"}

@app.post("/api/rooms/{room_id}/player/seek")
async def seek_track(room_id: str, seek_data: Dict[str, Any]):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    current_time = seek_data.get("currentTime", 0)
    user_id = seek_data.get("userId")
    
    room.currentTime = current_time
    datastore.rooms[room_id] = room
    datastore.save_rooms_to_file()
    
    await manager.broadcast_to_room(room_id, {
        "type": "player_seek",
        "currentTime": current_time,
        "userId": user_id
    })
    
    return {"message": "Seeked"}

@app.post("/api/rooms/{room_id}/player/next")
async def next_track(room_id: str, next_data: Dict[str, str]):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    user_id = next_data.get("userId")
    
    next_index = room.currentTrackIndex + 1
    
    if next_index >= len(room.tracks):
        if room.roomRepeatMode == "all":
            next_index = 0
        else:
            room.isPlaying = False
            datastore.rooms[room_id] = room
            datastore.save_rooms_to_file()
            return {"message": "End of playlist"}
    
    if next_index < len(room.tracks):
        room.currentTrack = room.tracks[next_index]
        room.currentTrackIndex = next_index
        room.currentTime = 0
        room.isPlaying = True
        
        datastore.rooms[room_id] = room
        datastore.save_rooms_to_file()
        
        await manager.broadcast_to_room(room_id, {
            "type": "player_next",
            "track": room.currentTrack.dict(),
            "index": next_index,
            "userId": user_id
        })
    
    return {"message": "Next track"}

@app.post("/api/rooms/{room_id}/player/prev")
async def prev_track(room_id: str, prev_data: Dict[str, str]):
    if room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = datastore.rooms[room_id]
    user_id = prev_data.get("userId")
    
    prev_index = room.currentTrackIndex - 1
    
    if prev_index < 0:
        if room.roomRepeatMode == "all":
            prev_index = len(room.tracks) - 1
        else:
            return {"message": "Beginning of playlist"}
    
    if prev_index >= 0 and prev_index < len(room.tracks):
        room.currentTrack = room.tracks[prev_index]
        room.currentTrackIndex = prev_index
        room.currentTime = 0
        room.isPlaying = True
        
        datastore.rooms[room_id] = room
        datastore.save_rooms_to_file()
        
        await manager.broadcast_to_room(room_id, {
            "type": "player_prev",
            "track": room.currentTrack.dict(),
            "index": prev_index,
            "userId": user_id
        })
    
    return {"message": "Previous track"}

# -------------------- ЧАТ --------------------
@app.post("/api/chat")
async def send_message(message: ChatMessage):
    if message.room_id not in datastore.rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    if message.room_id not in datastore.chat_messages:
        datastore.chat_messages[message.room_id] = []
    
    datastore.chat_messages[message.room_id].append(message)
    
    if len(datastore.chat_messages[message.room_id]) > 100:
        datastore.chat_messages[message.room_id] = datastore.chat_messages[message.room_id][-100:]
    
    await manager.broadcast_to_room(message.room_id, {
        "type": "chat_message",
        "message": message.dict()
    })
    
    return {"message": "Message sent"}

@app.get("/api/chat/{room_id}")
async def get_messages(room_id: str, limit: int = 50):
    messages = datastore.chat_messages.get(room_id, [])
    return {"messages": messages[-limit:]}

# ==================== WEB SOCKET ENDPOINT ====================

@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    await manager.connect(room_id, user_id, websocket)
    
    room = datastore.rooms.get(room_id)
    if room:
        await websocket.send_json({
            "type": "room_state",
            "room": room.dict()
        })
    
    await manager.broadcast_to_room(room_id, {
        "type": "user_connected",
        "user_id": user_id,
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")
            
            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
            
            elif message_type == "chat":
                message = ChatMessage(
                    room_id=room_id,
                    user_id=user_id,
                    user_name=data.get("user_name", "User"),
                    message=data.get("message", ""),
                    timestamp=datetime.now().isoformat()
                )
                
                if room_id not in datastore.chat_messages:
                    datastore.chat_messages[room_id] = []
                datastore.chat_messages[room_id].append(message)
                
                await manager.broadcast_to_room(room_id, {
                    "type": "chat_message",
                    "message": message.dict()
                })
            
    except WebSocketDisconnect:
        manager.disconnect(room_id, user_id, websocket)
        await manager.broadcast_to_room(room_id, {
            "type": "user_disconnected",
            "user_id": user_id,
            "timestamp": datetime.now().isoformat()
        })

# ==================== ЗАПУСК ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)