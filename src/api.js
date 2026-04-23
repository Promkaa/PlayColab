// frontend/src/api.js
const API_BASE_URL = 'http://localhost:8000/api';
const WS_BASE_URL = 'ws://localhost:8000/ws';

class MusicAPI {
    constructor() {
        this.baseURL = API_BASE_URL;
        this.wsBaseURL = WS_BASE_URL;
        this.wsConnections = new Map();
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        console.log(`📡 API Request: ${options.method || 'GET'} ${url}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            signal: controller.signal,
            ...options
        };

        try {
            const response = await fetch(url, config);
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({ detail: 'Request failed' }));
                throw new Error(error.detail || 'API request failed');
            }
            
            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timeout');
            }
            console.error(`❌ API Error (${endpoint}):`, error);
            throw error;
        }
    }

    // Auth methods
    async verifyToken(token) {
        return this.request('/verify-token', {
            method: 'POST',
            body: JSON.stringify({ token })
        });
    }

    // Music data methods (с user_id для персональных данных)
    async getMusicData(userId) {
        return this.request(`/music-data?user_id=${userId}`);
    }

    async getMusicStats(userId) {
        return this.request(`/music-stats?user_id=${userId}`);
    }

    // Parser methods
    async parseMusic(token, userId) {
        return this.request('/parse-music', {
            method: 'POST',
            body: JSON.stringify({ token, user_id: userId })
        });
    }

    async getParseStatus() {
        return this.request('/parse-status');
    }

    async syncPlaylist(playlistId, token, userId) {
        return this.request(`/sync-playlist/${playlistId}`, {
            method: 'POST',
            body: JSON.stringify({ token, user_id: userId })
        });
    }

    // Room methods
    async getRooms() {
        try {
            return await this.request('/rooms');
        } catch (error) {
            const savedRooms = localStorage.getItem('musicRooms');
            return savedRooms ? JSON.parse(savedRooms) : [];
        }
    }

    async createRoom(room) {
        return this.request('/rooms', {
            method: 'POST',
            body: JSON.stringify(room)
        });
    }

    async updateRoom(roomId, room) {
        return this.request(`/rooms/${roomId}`, {
            method: 'PUT',
            body: JSON.stringify(room)
        });
    }

    async deleteRoom(roomId) {
        return this.request(`/rooms/${roomId}`, {
            method: 'DELETE'
        });
    }

    // Participant methods
    async joinRoom(roomId, userId, userName) {
        return this.request(`/rooms/${roomId}/join`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, user_name: userName })
        });
    }

    async leaveRoom(roomId, userId) {
        return this.request(`/rooms/${roomId}/leave`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userId })
        });
    }

    // Track and voting methods
    async proposeTrack(roomId, track, userId, userName) {
        return this.request(`/rooms/${roomId}/propose-track`, {
            method: 'POST',
            body: JSON.stringify({ track, user_id: userId, user_name: userName })
        });
    }

    async castVoteInRoom(roomId, userId, vote) {
        return this.request(`/rooms/${roomId}/vote`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, vote })
        });
    }

    async addTrackToRoom(roomId, track) {
        return this.request(`/rooms/${roomId}/tracks`, {
            method: 'POST',
            body: JSON.stringify(track)
        });
    }

    async removeTrackFromRoom(roomId, trackId, userId) {
        return this.request(`/rooms/${roomId}/tracks/${trackId}?user_id=${userId}`, {
            method: 'DELETE'
        });
    }

    // Player control methods
    async playTrack(roomId, track, index, userId) {
        return this.request(`/rooms/${roomId}/player/play`, {
            method: 'POST',
            body: JSON.stringify({ track, index, userId })
        });
    }

    async pauseTrack(roomId, userId) {
        return this.request(`/rooms/${roomId}/player/pause`, {
            method: 'POST',
            body: JSON.stringify({ userId })
        });
    }

    async seekTrack(roomId, currentTime, userId) {
        return this.request(`/rooms/${roomId}/player/seek`, {
            method: 'POST',
            body: JSON.stringify({ currentTime, userId })
        });
    }

    async nextTrack(roomId, userId) {
        return this.request(`/rooms/${roomId}/player/next`, {
            method: 'POST',
            body: JSON.stringify({ userId })
        });
    }

    async prevTrack(roomId, userId) {
        return this.request(`/rooms/${roomId}/player/prev`, {
            method: 'POST',
            body: JSON.stringify({ userId })
        });
    }

    // Chat methods
    async sendMessage(roomId, userId, userName, message) {
        return this.request('/chat', {
            method: 'POST',
            body: JSON.stringify({ 
                room_id: roomId, 
                user_id: userId, 
                user_name: userName, 
                message, 
                timestamp: new Date().toISOString() 
            })
        });
    }

    async getMessages(roomId, limit = 50) {
        try {
            return await this.request(`/chat/${roomId}?limit=${limit}`);
        } catch (error) {
            return { messages: [] };
        }
    }

    // WebSocket methods
    connectWebSocket(roomId, userId, onMessage) {
        const wsUrl = `${this.wsBaseURL}/${roomId}/${userId}`;
        console.log(`🔌 Connecting WebSocket: ${wsUrl}`);
        
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log(`✅ WebSocket connected to room ${roomId}`);
            const interval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
            ws.pingInterval = interval;
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (onMessage) onMessage(data);
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        };
        
        ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
        };
        
        ws.onclose = () => {
            console.log(`🔌 WebSocket disconnected from room ${roomId}`);
            if (ws.pingInterval) clearInterval(ws.pingInterval);
            this.wsConnections.delete(roomId);
        };
        
        this.wsConnections.set(roomId, ws);
        return ws;
    }
    
    disconnectWebSocket(roomId) {
        const ws = this.wsConnections.get(roomId);
        if (ws) {
            if (ws.pingInterval) clearInterval(ws.pingInterval);
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        }
        this.wsConnections.delete(roomId);
    }
}

export default new MusicAPI();