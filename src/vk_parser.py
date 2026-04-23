import requests
import os
import sqlite3
import json
import time
from datetime import datetime
from typing import List, Dict, Any, Optional
import vk_api
from pathlib import Path

class VKTrackDatabase:
    def __init__(self, db_path="tracks.db"):
        self.db_path = db_path
        self.user_data_dir = Path(__file__).parent.parent / "user_data"
        self.user_data_dir.mkdir(exist_ok=True)
        self.init_database()

    def init_database(self):
        """Инициализация базы данных"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Создаём таблицу треков
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vk_id TEXT,
                user_id TEXT,
                artist TEXT NOT NULL,
                title TEXT NOT NULL,
                duration INTEGER,
                url TEXT,
                album_id TEXT,
                cover_url TEXT,
                cover_small TEXT,
                cover_big TEXT,
                original_order INTEGER,
                date_added INTEGER,
                playlist_type TEXT DEFAULT 'main',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                downloaded BOOLEAN DEFAULT 0,
                UNIQUE(vk_id, user_id)
            )
        ''')

        # Добавляем колонку user_id если её нет
        cursor.execute("PRAGMA table_info(tracks)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'user_id' not in columns:
            cursor.execute('ALTER TABLE tracks ADD COLUMN user_id TEXT')

        # Создаём таблицу плейлистов
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vk_playlist_id TEXT,
                user_id TEXT,
                owner_id INTEGER,
                title TEXT NOT NULL,
                description TEXT,
                count INTEGER,
                cover_url TEXT,
                access_hash TEXT,
                is_main BOOLEAN DEFAULT 0,
                last_sync TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(vk_playlist_id, user_id)
            )
        ''')

        # Добавляем колонку user_id в playlists если её нет
        cursor.execute("PRAGMA table_info(playlists)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'user_id' not in columns:
            cursor.execute('ALTER TABLE playlists ADD COLUMN user_id TEXT')

        # Создаём связующую таблицу
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS playlist_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER,
                track_id INTEGER,
                position INTEGER,
                original_position INTEGER,
                FOREIGN KEY (playlist_id) REFERENCES playlists (id),
                FOREIGN KEY (track_id) REFERENCES tracks (id),
                UNIQUE(playlist_id, track_id)
            )
        ''')

        conn.commit()
        conn.close()
        print("✅ База данных инициализирована")

    def extract_cover_urls(self, track):
        """Извлечение URL обложек"""
        cover_urls = {
            'cover_url': None,
            'cover_small': None,
            'cover_big': None
        }

        if 'album' in track and isinstance(track['album'], dict):
            thumb = track['album'].get('thumb')
            if thumb and isinstance(thumb, dict):
                for size in ['photo_1200', 'photo_600', 'photo_300']:
                    if size in thumb:
                        cover_urls['cover_url'] = thumb[size]
                        cover_urls['cover_big'] = thumb[size]
                        cover_urls['cover_small'] = thumb.get('photo_300', thumb[size])
                        break

        return cover_urls

    def add_track(self, track, user_id: str, order_index=None, playlist_type='main'):
        """Добавление трека в БД с привязкой к пользователю"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        covers = self.extract_cover_urls(track)

        try:
            cursor.execute('''
                INSERT OR REPLACE INTO tracks 
                (vk_id, user_id, artist, title, duration, url, album_id, cover_url, cover_small, cover_big, 
                 original_order, date_added, playlist_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                str(track.get('id')),
                user_id,
                track.get('artist', 'Unknown'),
                track.get('title', 'Unknown'),
                track.get('duration'),
                track.get('url'),
                str(track.get('album_id')) if track.get('album_id') else None,
                covers['cover_url'],
                covers['cover_small'],
                covers['cover_big'],
                order_index,
                track.get('date'),
                playlist_type
            ))
            conn.commit()
            return cursor.lastrowid
        except Exception as e:
            print(f"❌ Ошибка добавления трека: {e}")
            return None
        finally:
            conn.close()

    def save_playlist(self, playlist_data, user_id: str, owner_id: int, is_main=False):
        """Сохранение плейлиста в БД с привязкой к пользователю"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cover_url = None
            if 'photo' in playlist_data and isinstance(playlist_data['photo'], dict):
                cover_url = playlist_data['photo'].get('photo_300')

            vk_playlist_id = str(playlist_data.get('id')) if not is_main else 'main'

            cursor.execute('''
                INSERT OR REPLACE INTO playlists 
                (vk_playlist_id, user_id, owner_id, title, description, count, cover_url, access_hash, is_main, last_sync)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                vk_playlist_id,
                user_id,
                owner_id,
                playlist_data.get('title', 'Основной плейлист' if is_main else 'Без названия'),
                playlist_data.get('description', ''),
                playlist_data.get('count', 0),
                cover_url,
                playlist_data.get('access_hash'),
                is_main,
                datetime.now().isoformat()
            ))

            conn.commit()
            return cursor.lastrowid
        except Exception as e:
            print(f"❌ Ошибка сохранения плейлиста: {e}")
            return None
        finally:
            conn.close()

    def add_track_to_playlist(self, playlist_vk_id, track_vk_id, user_id: str, position=None):
        """Добавление трека в плейлист"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cursor.execute('SELECT id FROM playlists WHERE vk_playlist_id = ? AND user_id = ?', 
                          (str(playlist_vk_id), user_id))
            playlist = cursor.fetchone()
            if not playlist:
                return False
            playlist_id = playlist[0]

            cursor.execute('SELECT id FROM tracks WHERE vk_id = ? AND user_id = ?', 
                          (str(track_vk_id), user_id))
            track = cursor.fetchone()
            if not track:
                return False
            track_id = track[0]

            if position is None:
                cursor.execute('SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = ?', (playlist_id,))
                max_pos = cursor.fetchone()[0]
                position = (max_pos or 0) + 1

            cursor.execute('''
                INSERT OR REPLACE INTO playlist_tracks 
                (playlist_id, track_id, position, original_position)
                VALUES (?, ?, ?, ?)
            ''', (playlist_id, track_id, position, position))

            conn.commit()
            return True
        except Exception as e:
            print(f"❌ Ошибка: {e}")
            return False
        finally:
            conn.close()

    def get_user_playlists(self, user_id: str):
        """Получение всех плейлистов пользователя"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT DISTINCT p.* 
            FROM playlists p
            WHERE p.user_id = ?
            ORDER BY p.is_main DESC, p.title ASC
        ''', (user_id,))
        
        playlists = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return playlists

    def get_user_tracks_count(self, user_id: str):
        """Получение количества треков пользователя"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM tracks WHERE user_id = ?', (user_id,))
        count = cursor.fetchone()[0]
        conn.close()
        return count

    def get_playlist_tracks(self, playlist_vk_id: str, user_id: str):
        """Получение треков плейлиста пользователя"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT t.*, pt.position, pt.original_position
            FROM tracks t
            JOIN playlist_tracks pt ON t.id = pt.track_id
            JOIN playlists p ON pt.playlist_id = p.id
            WHERE p.vk_playlist_id = ? AND p.user_id = ?
            ORDER BY COALESCE(pt.original_position, pt.position) ASC
        ''', (str(playlist_vk_id), user_id))

        tracks = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return tracks

    def export_to_json(self, user_id: str, filename: str = None):
        """Экспорт данных пользователя в JSON файл"""
        if filename is None:
            filename = f"user_{user_id}_music.json"
        
        # Полный путь к файлу
        filepath = self.user_data_dir / filename
        
        # Получаем плейлисты пользователя
        playlists = self.get_user_playlists(user_id)
        
        export_data = {'playlists': [], 'exported_at': datetime.now().isoformat(), 'user_id': user_id}

        for playlist in playlists:
            tracks = self.get_playlist_tracks(playlist['vk_playlist_id'], user_id)
            
            formatted_tracks = []
            for track in tracks:
                formatted_tracks.append({
                    'id': track['id'],
                    'vk_id': track['vk_id'],
                    'artist': track['artist'],
                    'title': track['title'],
                    'duration': track['duration'],
                    'url': track['url'],
                    'cover_url': track['cover_url'],
                    'cover_small': track['cover_small'],
                    'cover_big': track['cover_big'],
                    'position': track['position']
                })

            export_data['playlists'].append({
                'id': playlist['id'],
                'vk_playlist_id': playlist['vk_playlist_id'],
                'title': playlist['title'],
                'description': playlist['description'],
                'cover_url': playlist['cover_url'],
                'is_main': bool(playlist['is_main']),
                'tracks': formatted_tracks,
                'actual_count': len(formatted_tracks)
            })

        # Сохраняем в файл
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)

        print(f"✅ Экспортировано в {filepath}: {len(export_data['playlists'])} плейлистов")
        
        # Также сохраняем копию в public для фронтенда
        frontend_path = Path(__file__).parent.parent.parent / "frontend" / "public" / filename
        if frontend_path.parent.exists():
            with open(frontend_path, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, ensure_ascii=False, indent=2)
            print(f"✅ Также сохранено в public: {frontend_path}")
        
        return str(filepath)


class VKMusicParser:
    def __init__(self):
        self.db = VKTrackDatabase()
        self.current_session = None
        self.is_parsing = False
        self.parse_progress = 0
        self.parse_status = "idle"
        self.current_user_id = None

    def authenticate(self, token: str) -> Dict[str, Any]:
        """Аутентификация через VK токен"""
        try:
            session = vk_api.VkApi(token=token)
            vk = session.get_api()
            user = vk.users.get()[0]
            
            self.current_session = session
            return {
                'success': True,
                'user': {
                    'id': str(user['id']),
                    'first_name': user['first_name'],
                    'last_name': user['last_name'],
                    'full_name': f"{user['first_name']} {user['last_name']}"
                }
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_all_audio_with_pagination(self, owner_id: int, count_per_request: int = 200) -> List[Dict]:
        """Получение всех аудиозаписей пользователя"""
        all_tracks = []
        offset = 0
        page = 1

        print(f"🎵 Получение треков пользователя {owner_id}...")

        while True:
            try:
                code = f"""
                var result = API.audio.get({{
                    "owner_id": {owner_id},
                    "count": {count_per_request},
                    "offset": {offset}
                }});
                return result;
                """
                response = self.current_session.method('execute', {'code': code})
                
                if not response:
                    break

                items = response.get('items', [])
                if not items:
                    break

                all_tracks.extend(items)
                print(f"   Страница {page}: +{len(items)} треков (всего: {len(all_tracks)})")

                if len(items) < count_per_request:
                    break

                offset += count_per_request
                page += 1
                time.sleep(0.1)

            except Exception as e:
                print(f"❌ Ошибка: {e}")
                break

        return all_tracks

    def get_vk_playlists(self, owner_id: int) -> List[Dict]:
        """Получение всех плейлистов пользователя"""
        try:
            code = f"""
            var playlists = API.audio.getPlaylists({{
                "owner_id": {owner_id},
                "count": 100
            }});
            return playlists;
            """
            response = self.current_session.method('execute', {'code': code})
            
            if response and 'items' in response:
                return response['items']
            return []
        except Exception as e:
            print(f"❌ Ошибка получения плейлистов: {e}")
            return []

    def get_playlist_tracks(self, owner_id: int, playlist_id: int, access_hash: str = None) -> List[Dict]:
        """Получение треков из плейлиста"""
        all_tracks = []
        offset = 0
        count_per_request = 200

        while True:
            try:
                code = f"""
                var params = {{
                    "owner_id": {owner_id},
                    "playlist_id": {playlist_id},
                    "count": {count_per_request},
                    "offset": {offset}
                }};
                """
                if access_hash:
                    code += f'params.access_hash = "{access_hash}";'

                code += """
                var tracks = API.audio.get(params);
                return tracks;
                """
                response = self.current_session.method('execute', {'code': code})

                if not response or 'items' not in response:
                    break

                items = response['items']
                if not items:
                    break

                all_tracks.extend(items)

                if len(items) < count_per_request:
                    break

                offset += count_per_request
                time.sleep(0.1)

            except Exception as e:
                print(f"❌ Ошибка: {e}")
                break

        return all_tracks

    def parse_user_music(self, token: str, user_id: str = None) -> Dict[str, Any]:
        """Парсинг всей музыки пользователя с сохранением в персональный файл"""
        if self.is_parsing:
            return {'success': False, 'error': 'Парсинг уже выполняется'}

        auth_result = self.authenticate(token)
        if not auth_result['success']:
            return auth_result

        user = auth_result['user']
        vk_user_id = user['id']
        
        # Используем переданный user_id или ID из VK
        target_user_id = user_id or vk_user_id
        self.current_user_id = target_user_id
        
        self.is_parsing = True
        self.parse_status = "parsing_tracks"
        self.parse_progress = 0

        try:
            # Получаем все треки пользователя
            print(f"\n📀 Получение основного плейлиста пользователя {user['full_name']} (ID: {target_user_id})...")
            all_tracks = self.get_all_audio_with_pagination(int(vk_user_id))
            
            if all_tracks:
                self.parse_progress = 30
                self.parse_status = "saving_tracks"
                
                # Сохраняем основной плейлист
                main_playlist = {
                    'id': 'main',
                    'title': 'Моя музыка',
                    'description': 'Основной плейлист',
                    'count': len(all_tracks)
                }
                self.db.save_playlist(main_playlist, target_user_id, int(vk_user_id), is_main=True)
                
                # Сохраняем треки
                for index, track in enumerate(all_tracks):
                    self.db.add_track(track, target_user_id, index, 'main')
                    if index % 50 == 0:
                        self.parse_progress = 30 + (index / len(all_tracks)) * 40
                
                # Добавляем треки в основной плейлист
                for index, track in enumerate(all_tracks):
                    self.db.add_track_to_playlist('main', track.get('id'), target_user_id, index)
                
                print(f"✅ Сохранено {len(all_tracks)} треков основного плейлиста для пользователя {target_user_id}")
            
            self.parse_progress = 70
            self.parse_status = "parsing_playlists"
            
            # Получаем плейлисты
            print(f"\n📁 Получение плейлистов...")
            vk_playlists = self.get_vk_playlists(int(vk_user_id))
            
            for i, playlist in enumerate(vk_playlists):
                self.parse_progress = 70 + (i / len(vk_playlists)) * 20
                
                # Сохраняем плейлист
                self.db.save_playlist(playlist, target_user_id, int(vk_user_id), is_main=False)
                
                # Получаем треки плейлиста
                playlist_tracks = self.get_playlist_tracks(
                    int(vk_user_id),
                    playlist.get('id'),
                    playlist.get('access_hash')
                )
                
                if playlist_tracks:
                    # Сохраняем треки
                    for index, track in enumerate(playlist_tracks):
                        self.db.add_track(track, target_user_id, index, 'playlist')
                        self.db.add_track_to_playlist(playlist.get('id'), track.get('id'), target_user_id, index)
                    
                    print(f"   📋 {playlist.get('title')}: {len(playlist_tracks)} треков")
            
            self.parse_progress = 90
            self.parse_status = "exporting"
            
            # Экспортируем в JSON
            json_file = self.db.export_to_json(target_user_id)
            
            self.parse_progress = 100
            self.parse_status = "completed"
            self.is_parsing = False
            
            return {
                'success': True,
                'message': 'Парсинг музыки завершен',
                'tracks_count': self.db.get_user_tracks_count(target_user_id),
                'playlists_count': len(self.db.get_user_playlists(target_user_id)),
                'json_file': json_file,
                'user_id': target_user_id,
                'user': user
            }
            
        except Exception as e:
            self.is_parsing = False
            self.parse_status = "error"
            print(f"❌ Ошибка парсинга: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}

    def get_parse_status(self) -> Dict[str, Any]:
        """Получение статуса парсинга"""
        return {
            'is_parsing': self.is_parsing,
            'progress': self.parse_progress,
            'status': self.parse_status
        }

    def sync_playlist(self, token: str, playlist_id: str, user_id: str = None) -> Dict[str, Any]:
        """Синхронизация конкретного плейлиста"""
        auth_result = self.authenticate(token)
        if not auth_result['success']:
            return auth_result

        user = auth_result['user']
        vk_user_id = user['id']
        target_user_id = user_id or str(vk_user_id)
        
        try:
            # Получаем актуальные данные плейлиста
            vk_playlists = self.get_vk_playlists(int(vk_user_id))
            playlist_data = next((p for p in vk_playlists if str(p.get('id')) == playlist_id), None)
            
            if not playlist_data:
                return {'success': False, 'error': 'Плейлист не найден'}
            
            # Обновляем плейлист
            self.db.save_playlist(playlist_data, target_user_id, int(vk_user_id), is_main=False)
            
            # Получаем актуальные треки
            playlist_tracks = self.get_playlist_tracks(
                int(vk_user_id),
                playlist_data.get('id'),
                playlist_data.get('access_hash')
            )
            
            # Очищаем старые связи
            conn = sqlite3.connect(self.db.db_path)
            cursor = conn.cursor()
            cursor.execute('''
                DELETE FROM playlist_tracks 
                WHERE playlist_id = (SELECT id FROM playlists WHERE vk_playlist_id = ? AND user_id = ?)
            ''', (playlist_id, target_user_id))
            conn.commit()
            conn.close()
            
            # Добавляем новые треки
            for index, track in enumerate(playlist_tracks):
                self.db.add_track(track, target_user_id, index, 'playlist')
                self.db.add_track_to_playlist(playlist_id, track.get('id'), target_user_id, index)
            
            # Экспортируем обновленные данные
            self.db.export_to_json(target_user_id)
            
            return {
                'success': True,
                'message': f'Плейлист "{playlist_data.get("title")}" синхронизирован',
                'tracks_count': len(playlist_tracks)
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}


# Глобальный экземпляр парсера
vk_parser = VKMusicParser()