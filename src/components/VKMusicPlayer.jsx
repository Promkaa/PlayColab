'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import MusicAPI from '../api';
import '../css/playlist.css';

const VKMusicPlayer = () => {
    // Auth states
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [accessToken, setAccessToken] = useState('');
    const [tokenInput, setTokenInput] = useState('');
    const [authError, setAuthError] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);
    const [currentUsername, setCurrentUsername] = useState('');
    const [currentUserId, setCurrentUserId] = useState('');
    
    // Playlist states
    const [playlists, setPlaylists] = useState([]);
    const [currentPlaylist, setCurrentPlaylist] = useState(null);
    const [tracks, setTracks] = useState([]);
    const [filteredVkTracks, setFilteredVkTracks] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [vkSearchTerm, setVkSearchTerm] = useState('');
    
    // Player states
    const [currentTrack, setCurrentTrack] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.7);
    const [isLoading, setIsLoading] = useState(false);
    
    // Room states
    const [rooms, setRooms] = useState([]);
    const [currentRoom, setCurrentRoom] = useState(null);
    const [roomName, setRoomName] = useState('');
    const [roomSearchTerm, setRoomSearchTerm] = useState('');
    const [participants, setParticipants] = useState([]);
    const [roomTracks, setRoomTracks] = useState([]);
    const [roomScenario, setRoomScenario] = useState('withVoting');
    const [roomCurrentTrackIndex, setRoomCurrentTrackIndex] = useState(-1);
    const [roomIsShuffled, setRoomIsShuffled] = useState(false);
    const [roomRepeatMode, setRoomRepeatMode] = useState('off');
    const [roomShuffledIndices, setRoomShuffledIndices] = useState([]);
    
    // UI states
    const [showPlaylistSidebar, setShowPlaylistSidebar] = useState(false);
    const [showMakeRoom, setShowMakeRoom] = useState(false);
    const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
    const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
    const [roomToDelete, setRoomToDelete] = useState(null);
    const [showSavePlaylistModal, setShowSavePlaylistModal] = useState(false);
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [savePlaylistError, setSavePlaylistError] = useState('');
    const [showMusicParser, setShowMusicParser] = useState(false);
    
    // Voting states
    const [showVotingModal, setShowVotingModal] = useState(false);
    const [votingTrack, setVotingTrack] = useState(null);
    const [votingSessionId, setVotingSessionId] = useState(null);
    const [votesYes, setVotesYes] = useState(0);
    const [votesNo, setVotesNo] = useState(0);
    const [userVote, setUserVote] = useState(null);
    const [votingProposedBy, setVotingProposedBy] = useState('');
    const [votingTimer, setVotingTimer] = useState(60);
    const [totalParticipants, setTotalParticipants] = useState(0);
    const [totalVoted, setTotalVoted] = useState(0);
    
    // Parser states
    const [isParsing, setIsParsing] = useState(false);
    const [parseProgress, setParseProgress] = useState(0);
    const [parseStatus, setParseStatus] = useState('');
    const [musicStats, setMusicStats] = useState(null);
    
    // Chat states
    const [showChat, setShowChat] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    
    // Timer ref
    const votingTimerRef = useRef(null);
    
    // Refs
    const audioRef = useRef(null);
    const hlsRef = useRef(null);
    const wsRef = useRef(null);

    // Helper functions
    const shuffleArray = (array) => {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    };

    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const getCoverUrl = (track, size = 'small') => {
        const coverUrl = size === 'small' ? track?.cover_small : track?.cover_big || track?.cover_url;
        return coverUrl || null;
    };

    // Save/Load state
    const saveAppState = useCallback(() => {
        const stateToSave = {
            accessToken: accessToken,
            isAuthenticated: isAuthenticated,
            currentUsername: currentUsername,
            currentUserId: currentUserId,
            currentPlaylistId: currentPlaylist?.id,
            volume: volume,
            savedAt: Date.now()
        };
        localStorage.setItem('vk_music_app_state', JSON.stringify(stateToSave));
    }, [accessToken, isAuthenticated, currentUsername, currentUserId, currentPlaylist, volume]);

    const loadAppState = useCallback(async () => {
        const savedState = localStorage.getItem('vk_music_app_state');
        const savedToken = localStorage.getItem('vk_access_token');
        
        if (!savedToken) {
            setIsInitializing(false);
            return false;
        }
        
        const isValid = await verifyToken(savedToken, false);
        
        if (!isValid) {
            setIsInitializing(false);
            return false;
        }
        
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                setVolume(state.volume || 0.7);
                setCurrentUsername(state.currentUsername || '');
                setCurrentUserId(state.currentUserId || '');
            } catch (error) {
                console.error('Error loading state:', error);
            }
        }
        
        return true;
    }, []);

    // WebSocket connection
    const connectWebSocket = useCallback((roomId, userId) => {
        const wsUrl = `ws://${window.location.hostname}:8000/ws/${roomId}/${userId}`;
        console.log('Connecting WebSocket:', wsUrl);
        
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
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
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected');
            if (ws.pingInterval) clearInterval(ws.pingInterval);
            setTimeout(() => {
                if (currentRoom) {
                    connectWebSocket(currentRoom.id, currentUserId);
                }
            }, 3000);
        };
        
        wsRef.current = ws;
        return ws;
    }, [currentRoom, currentUserId]);

    const disconnectWebSocket = () => {
        if (wsRef.current) {
            if (wsRef.current.pingInterval) clearInterval(wsRef.current.pingInterval);
            if (wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.close();
            }
        }
        wsRef.current = null;
    };

    // Handle WebSocket messages
    const handleWebSocketMessage = useCallback((data) => {
        console.log('WebSocket message:', data.type);
        
        switch (data.type) {
            case 'room_state':
                if (data.room) {
                    setCurrentRoom(data.room);
                    setParticipants(data.room.participants || []);
                    setRoomTracks(data.room.tracks || []);
                    if (data.room.currentTrack) {
                        setCurrentTrack(data.room.currentTrack);
                        setIsPlaying(data.room.isPlaying);
                        setCurrentTime(data.room.currentTime);
                    }
                }
                break;
                
            case 'user_joined':
                setParticipants(prev => [...prev, data.user]);
                addSystemMessage(`${data.user.name} присоединился к комнате`);
                break;
                
            case 'user_left':
                setParticipants(prev => prev.filter(p => p.id !== data.user_id));
                addSystemMessage(`Пользователь покинул комнату`);
                break;
                
            case 'track_added':
                setRoomTracks(prev => [...prev, data.track]);
                addSystemMessage(`➕ Добавлен трек: ${data.track.title} - ${data.track.artist}`);
                break;
                
            case 'track_added_direct':
                setRoomTracks(prev => [...prev, data.track]);
                addSystemMessage(`➕ ${data.added_by} добавил трек: ${data.track.title}`);
                break;
                
            case 'track_removed':
                setRoomTracks(prev => prev.filter(t => t.id !== data.track_id && t.vk_id !== data.track_id));
                addSystemMessage(`❌ Трек удален из плейлиста`);
                break;
                
            case 'player_play':
                setCurrentTrack(data.track);
                setIsPlaying(true);
                setCurrentTime(0);
                break;
                
            case 'player_pause':
                setIsPlaying(false);
                setCurrentTime(data.currentTime);
                break;
                
            case 'player_seek':
                setCurrentTime(data.currentTime);
                if (audioRef.current) {
                    audioRef.current.currentTime = data.currentTime;
                }
                break;
                
            case 'player_next':
            case 'player_prev':
                setCurrentTrack(data.track);
                setCurrentTime(0);
                setIsPlaying(true);
                break;
                
            case 'voting_started':
                console.log('Voting started:', data);
                setVotingTrack(data.track);
                setVotingSessionId(data.session_id);
                setVotesYes(0);
                setVotesNo(0);
                setUserVote(null);
                setVotingProposedBy(data.proposed_by);
                setVotingTimer(60);
                setTotalParticipants(data.total_participants || 0);
                setTotalVoted(0);
                setShowVotingModal(true);
                addSystemMessage(`🎵 Началось голосование за трек "${data.track.title}" от ${data.proposed_by}`);
                
                if (votingTimerRef.current) clearInterval(votingTimerRef.current);
                votingTimerRef.current = setInterval(() => {
                    setVotingTimer(prev => {
                        if (prev <= 1) {
                            clearInterval(votingTimerRef.current);
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);
                break;
                
            case 'vote_update':
                console.log('Vote update:', data);
                setVotesYes(data.votes_yes);
                setVotesNo(data.votes_no);
                setTotalVoted(data.total_voted);
                break;
                
            case 'voting_completed':
                console.log('Voting completed:', data);
                clearInterval(votingTimerRef.current);
                setShowVotingModal(false);
                setVotingTrack(null);
                setVotingSessionId(null);
                setUserVote(null);
                
                if (data.accepted) {
                    setRoomTracks(prev => [...prev, data.track]);
                }
                
                addSystemMessage(data.message);
                break;
                
            case 'voting_timeout':
                console.log('Voting timeout:', data);
                clearInterval(votingTimerRef.current);
                setShowVotingModal(false);
                setVotingTrack(null);
                setVotingSessionId(null);
                setUserVote(null);
                
                if (data.accepted) {
                    setRoomTracks(prev => [...prev, data.track]);
                }
                
                addSystemMessage(data.message);
                break;
                
            case 'chat_message':
                setChatMessages(prev => [...prev, data.message]);
                break;
                
            default:
                console.log('Unknown message type:', data.type);
        }
    }, []);

    const addSystemMessage = (message) => {
        const systemMsg = {
            id: 'system_' + Date.now(),
            user_id: 'system',
            user_name: '💬 Система',
            message: message,
            timestamp: new Date().toISOString()
        };
        setChatMessages(prev => [...prev, systemMsg]);
    };

    // API functions
    const verifyToken = async (token, showErrors = true) => {
        setIsVerifying(true);
        if (showErrors) setAuthError('');
        
        try {
            const response = await MusicAPI.verifyToken(token);
            
            if (!response.valid) {
                if (showErrors) setAuthError(response.error || 'Неверный токен');
                setIsVerifying(false);
                return false;
            }
            
            if (response.user) {
                setCurrentUsername(response.user.full_name);
                setCurrentUserId(response.user.id);
                localStorage.setItem('vk_username', response.user.full_name);
                localStorage.setItem('vk_user_id', response.user.id);
            }
            
            localStorage.setItem('vk_access_token', token);
            setAccessToken(token);
            setIsAuthenticated(true);
            setIsVerifying(false);
            return true;
            
        } catch (error) {
            console.error('Error verifying token:', error);
            if (showErrors) setAuthError('Ошибка подключения к серверу');
            setIsVerifying(false);
            return false;
        }
    };

    const fetchMusicData = async () => {
        if (!currentUserId) return;
        
        try {
            const data = await MusicAPI.getMusicData(currentUserId);
            
            if (data.playlists && data.playlists.length > 0) {
                setPlaylists(data.playlists);
                
                const savedState = localStorage.getItem('vk_music_app_state');
                if (savedState) {
                    const state = JSON.parse(savedState);
                    const savedPlaylist = data.playlists.find(p => p.id == state.currentPlaylistId);
                    if (savedPlaylist) {
                        setCurrentPlaylist(savedPlaylist);
                        setTracks(savedPlaylist.tracks || []);
                        setFilteredVkTracks(savedPlaylist.tracks || []);
                    } else {
                        const mainPlaylist = data.playlists.find(p => p.is_main) || data.playlists[0];
                        setCurrentPlaylist(mainPlaylist);
                        setTracks(mainPlaylist.tracks || []);
                        setFilteredVkTracks(mainPlaylist.tracks || []);
                    }
                } else {
                    const mainPlaylist = data.playlists.find(p => p.is_main) || data.playlists[0];
                    setCurrentPlaylist(mainPlaylist);
                    setTracks(mainPlaylist.tracks || []);
                    setFilteredVkTracks(mainPlaylist.tracks || []);
                }
            } else {
                const emptyPlaylist = {
                    id: 'empty',
                    title: 'Моя музыка',
                    description: 'Нажмите "Синхронизация" для загрузки музыки',
                    is_main: true,
                    tracks: [],
                    actual_count: 0
                };
                setPlaylists([emptyPlaylist]);
                setCurrentPlaylist(emptyPlaylist);
                setTracks([]);
                setFilteredVkTracks([]);
            }
        } catch (error) {
            console.error('Error fetching music data:', error);
        }
    };

    const loadRooms = async () => {
        try {
            const roomsList = await MusicAPI.getRooms();
            setRooms(roomsList);
        } catch (error) {
            console.error('Error loading rooms:', error);
            const savedRooms = localStorage.getItem('musicRooms');
            if (savedRooms) {
                setRooms(JSON.parse(savedRooms));
            }
        }
    };

    const loadMusicStats = async () => {
        if (!currentUserId) return;
        
        try {
            const stats = await MusicAPI.getMusicStats(currentUserId);
            setMusicStats(stats);
        } catch (error) {
            console.error('Error loading music stats:', error);
            setMusicStats({
                total_tracks: 0,
                total_playlists: 1,
                playlists: [{ id: 'main', title: 'Моя музыка', tracks_count: 0, is_main: true }]
            });
        }
    };

    // Room functions
    const createRoom = async () => {
        if (!roomName.trim()) {
            alert('Введите название комнаты');
            return;
        }

        const newRoom = {
            id: Date.now().toString(),
            name: roomName,
            createdAt: new Date().toISOString(),
            creator: currentUsername,
            creator_id: currentUserId,
            participants: [{ 
                id: currentUserId, 
                name: currentUsername, 
                isCreator: true,
                joined_at: new Date().toISOString()
            }],
            tracks: [],
            scenario: roomScenario,
            currentTrack: null,
            currentTrackIndex: -1,
            isPlaying: false,
            currentTime: 0,
            roomIsShuffled: false,
            roomRepeatMode: 'off'
        };

        try {
            await MusicAPI.createRoom(newRoom);
            const updatedRooms = [...rooms, newRoom];
            setRooms(updatedRooms);
            localStorage.setItem('musicRooms', JSON.stringify(updatedRooms));
            
            setRoomName('');
            setRoomScenario('withVoting');
            setShowCreateRoomModal(false);
            await joinRoom(newRoom);
        } catch (error) {
            console.error('Error creating room:', error);
            alert('Ошибка создания комнаты');
        }
    };

    const joinRoom = async (room) => {
        try {
            const isAlreadyParticipant = room.participants.some(p => p.id === currentUserId);
            
            if (!isAlreadyParticipant) {
                await MusicAPI.joinRoom(room.id, currentUserId, currentUsername);
            }
            
            connectWebSocket(room.id, currentUserId);
            
            try {
                const chatHistory = await MusicAPI.getMessages(room.id);
                setChatMessages(chatHistory.messages || []);
            } catch (error) {
                console.error('Error loading chat:', error);
            }
            
            setCurrentRoom(room);
            setParticipants(room.participants);
            setRoomTracks(room.tracks || []);
            setShowMakeRoom(false);
            setShowChat(true);
            setVkSearchTerm('');
            setRoomSearchTerm('');
            
            saveAppState();
        } catch (error) {
            console.error('Error joining room:', error);
            alert('Ошибка подключения к комнате');
        }
    };

    const leaveRoom = async () => {
        if (currentRoom) {
            try {
                await MusicAPI.leaveRoom(currentRoom.id, currentUserId);
                disconnectWebSocket();
            } catch (error) {
                console.error('Error leaving room:', error);
            }
        }
        
        setCurrentRoom(null);
        setParticipants([]);
        setRoomTracks([]);
        setChatMessages([]);
        setShowChat(false);
        setCurrentTrack(null);
        setIsPlaying(false);
        setVotingTrack(null);
        setShowVotingModal(false);
        setVkSearchTerm('');
        setRoomSearchTerm('');
        
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
        }
        
        saveAppState();
    };

    const deleteRoom = async () => {
        if (!roomToDelete) return;
        
        if (roomToDelete.creator !== currentUsername && roomToDelete.creator_id !== currentUserId) {
            alert('Только создатель комнаты может удалить её');
            return;
        }

        try {
            await MusicAPI.deleteRoom(roomToDelete.id);
            const updatedRooms = rooms.filter(r => r.id !== roomToDelete.id);
            setRooms(updatedRooms);
            localStorage.setItem('musicRooms', JSON.stringify(updatedRooms));
            
            if (currentRoom && currentRoom.id === roomToDelete.id) {
                await leaveRoom();
            }
            
            setShowDeleteConfirmModal(false);
            setRoomToDelete(null);
            alert(`Комната "${roomToDelete.name}" удалена`);
        } catch (error) {
            console.error('Error deleting room:', error);
            alert('Ошибка удаления комнаты');
        }
    };

    // Track functions
    const proposeTrack = async (track) => {
        if (!currentRoom) {
            alert('Сначала войдите в комнату');
            return;
        }

        const isTrackExists = roomTracks.some(t => t.id === track.id || t.vk_id === track.vk_id);
        if (isTrackExists) {
            alert('Эта песня уже добавлена в комнату');
            return;
        }

        const trackData = {
            id: track.id || track.vk_id,
            vk_id: track.vk_id,
            artist: track.artist,
            title: track.title,
            duration: track.duration,
            url: track.url,
            cover_url: track.cover_url,
            cover_small: track.cover_small,
            cover_big: track.cover_big
        };

        try {
            await MusicAPI.proposeTrack(currentRoom.id, trackData, currentUserId, currentUsername);
        } catch (error) {
            console.error('Error proposing track:', error);
            alert('Ошибка предложения трека: ' + (error.message || 'Неизвестная ошибка'));
        }
    };

    const castVote = async (voteValue) => {
        if (userVote) {
            alert('Вы уже проголосовали');
            return;
        }

        try {
            await MusicAPI.castVoteInRoom(currentRoom.id, currentUserId, voteValue);
            setUserVote(voteValue);
        } catch (error) {
            console.error('Error casting vote:', error);
            alert('Ошибка при голосовании');
        }
    };

    const addTrackToRoom = async (track) => {
        if (!currentRoom) {
            alert('Сначала войдите в комнату');
            return;
        }

        const isTrackExists = roomTracks.some(t => t.id === track.id || t.vk_id === track.vk_id);
        
        if (isTrackExists) {
            alert('Эта песня уже добавлена в комнату');
            return;
        }

        const trackWithAddedBy = {
            id: String(track.id || track.vk_id || Date.now()),
            vk_id: track.vk_id ? String(track.vk_id) : null,
            artist: String(track.artist || 'Unknown'),
            title: String(track.title || 'Unknown'),
            duration: Number(track.duration) || 0,
            url: track.url ? String(track.url) : null,
            cover_url: track.cover_url ? String(track.cover_url) : null,
            cover_small: track.cover_small ? String(track.cover_small) : null,
            cover_big: track.cover_big ? String(track.cover_big) : null,
            added_by: String(currentUsername),
            added_by_id: String(currentUserId),
            added_at: new Date().toISOString()
        };

        try {
            await MusicAPI.addTrackToRoom(currentRoom.id, trackWithAddedBy);
        } catch (error) {
            console.error('Error adding track:', error);
            alert('Ошибка добавления трека');
        }
    };

    const removeTrackFromRoom = async (trackId) => {
        const trackToRemove = roomTracks.find(t => t.id === trackId || t.vk_id === trackId);
        
        if (trackToRemove && trackToRemove.added_by_id !== currentUserId && 
            !participants.find(p => p.id === currentUserId && p.isCreator)) {
            alert('Вы можете удалять только свои добавленные песни');
            return;
        }

        try {
            await MusicAPI.removeTrackFromRoom(currentRoom.id, trackId, currentUserId);
        } catch (error) {
            console.error('Error removing track:', error);
            alert('Ошибка удаления трека');
        }
    };

    // Player functions
    const playTrackFromRoom = async (track, index) => {
        if (!currentRoom) return;
        
        const trackData = {
            id: track.id || track.vk_id,
            title: track.title,
            artist: track.artist,
            url: track.url,
            duration: track.duration,
            cover_small: track.cover_small,
            cover_big: track.cover_big
        };
        
        try {
            await MusicAPI.playTrack(currentRoom.id, trackData, index, currentUserId);
            setRoomCurrentTrackIndex(index);
        } catch (error) {
            console.error('Error playing track:', error);
        }
    };

    const nextTrack = async () => {
        if (!currentRoom) return;
        try {
            await MusicAPI.nextTrack(currentRoom.id, currentUserId);
        } catch (error) {
            console.error('Error next track:', error);
        }
    };

    const prevTrack = async () => {
        if (!currentRoom) return;
        try {
            await MusicAPI.prevTrack(currentRoom.id, currentUserId);
        } catch (error) {
            console.error('Error prev track:', error);
        }
    };

    const pauseTrack = async () => {
        if (!currentRoom) return;
        try {
            await MusicAPI.pauseTrack(currentRoom.id, currentUserId);
            setIsPlaying(false);
        } catch (error) {
            console.error('Error pausing track:', error);
        }
    };

    const handleSeek = async (e) => {
        const newTime = parseFloat(e.target.value);
        setCurrentTime(newTime);
        if (audioRef.current) {
            audioRef.current.currentTime = newTime;
        }
        
        if (currentRoom) {
            try {
                await MusicAPI.seekTrack(currentRoom.id, newTime, currentUserId);
            } catch (error) {
                console.error('Error seeking:', error);
            }
        }
    };

    // Voting trigger function
    const startVoting = (track) => {
        if (currentRoom.scenario === 'withVoting') {
            proposeTrack(track);
        } else {
            addTrackToRoom(track);
        }
    };

    // Chat functions
    const sendChatMessage = async () => {
        if (!newMessage.trim() || !currentRoom) return;
        
        try {
            await MusicAPI.sendMessage(
                currentRoom.id,
                currentUserId,
                currentUsername,
                newMessage
            );
            
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: 'chat',
                    message: newMessage
                }));
            }
            
            setNewMessage('');
        } catch (error) {
            console.error('Error sending message:', error);
        }
    };

    // Parser functions
    const startParsing = async () => {
        try {
            setIsParsing(true);
            const result = await MusicAPI.parseMusic(accessToken, currentUserId);
            if (result.success) {
                checkParseStatus();
            } else {
                alert('Ошибка парсинга: ' + (result.error || 'Неизвестная ошибка'));
                setIsParsing(false);
            }
        } catch (error) {
            console.error('Error starting parse:', error);
            alert('Ошибка запуска парсинга');
            setIsParsing(false);
        }
    };

    const checkParseStatus = async () => {
        try {
            const status = await MusicAPI.getParseStatus();
            setIsParsing(status.is_parsing);
            setParseProgress(status.progress);
            setParseStatus(status.status);
            
            if (status.is_parsing) {
                setTimeout(checkParseStatus, 2000);
            } else if (status.status === 'completed') {
                await fetchMusicData();
                await loadMusicStats();
                alert('Синхронизация музыки завершена!');
                setShowMusicParser(false);
            }
        } catch (error) {
            console.error('Error checking parse status:', error);
        }
    };

    const syncPlaylist = async (playlistId) => {
        try {
            const result = await MusicAPI.syncPlaylist(playlistId, accessToken, currentUserId);
            if (result.success) {
                alert(result.message);
                await fetchMusicData();
                await loadMusicStats();
            } else {
                alert('Ошибка синхронизации: ' + result.error);
            }
        } catch (error) {
            console.error('Error syncing playlist:', error);
            alert('Ошибка синхронизации плейлиста');
        }
    };

    // Save playlist
    const saveRoomPlaylist = async () => {
        if (!newPlaylistName.trim()) {
            setSavePlaylistError('Введите название плейлиста');
            return;
        }
        
        if (roomTracks.length === 0) {
            setSavePlaylistError('В комнате нет треков для сохранения');
            return;
        }
        
        const existingPlaylist = playlists.find(p => p.title === newPlaylistName.trim());
        if (existingPlaylist) {
            setSavePlaylistError('Плейлист с таким названием уже существует');
            return;
        }
        
        const newPlaylist = {
            id: 'user_' + Date.now(),
            title: newPlaylistName.trim(),
            description: `Сохранен из комнаты "${currentRoom.name}" ${new Date().toLocaleString()}`,
            is_main: false,
            is_user_created: true,
            tracks: [...roomTracks],
            actual_count: roomTracks.length,
            created_from_room: currentRoom.name,
            created_at: new Date().toISOString()
        };
        
        const updatedPlaylists = [...playlists, newPlaylist];
        setPlaylists(updatedPlaylists);
        
        const userPlaylists = updatedPlaylists.filter(p => !p.vk_playlist_id && p.is_user_created);
        localStorage.setItem('savedPlaylists', JSON.stringify(userPlaylists));
        
        setShowSavePlaylistModal(false);
        setNewPlaylistName('');
        setSavePlaylistError('');
        
        alert(`Плейлист "${newPlaylistName}" успешно сохранен!`);
    };

    const switchPlaylist = (playlist) => {
        setCurrentPlaylist(playlist);
        setTracks(playlist.tracks || []);
        setFilteredVkTracks(playlist.tracks || []);
        setSearchTerm('');
        setVkSearchTerm('');
        saveAppState();
    };

    // Auth functions
    const handleLogin = async () => {
        if (!tokenInput.trim()) {
            setAuthError('Пожалуйста, введите токен');
            return;
        }
        
        await verifyToken(tokenInput.trim());
    };

    const handleLogout = () => {
        localStorage.removeItem('vk_access_token');
        localStorage.removeItem('vk_music_app_state');
        localStorage.removeItem('vk_username');
        localStorage.removeItem('vk_user_id');
        localStorage.removeItem('savedPlaylists');
        localStorage.removeItem('musicRooms');
        
        disconnectWebSocket();
        
        setIsAuthenticated(false);
        setAccessToken('');
        setTokenInput('');
        setPlaylists([]);
        setCurrentPlaylist(null);
        setTracks([]);
        setCurrentTrack(null);
        setIsPlaying(false);
        setCurrentRoom(null);
        setRooms([]);
        setCurrentUsername('');
        setCurrentUserId('');
        setRoomTracks([]);
        setParticipants([]);
        setChatMessages([]);
        
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
        }
    };

    // Audio effects
    useEffect(() => {
        if (!currentTrack || !audioRef.current) return;

        const audio = audioRef.current;
        const trackUrl = currentTrack.url;

        if (!trackUrl) return;

        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        audio.pause();
        
        if (trackUrl.includes('.m3u8') && Hls.isSupported()) {
            const hls = new Hls({
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
                enableWorker: true,
            });

            hls.loadSource(trackUrl);
            hls.attachMedia(audio);
            hlsRef.current = hls;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                setIsLoading(false);
                if (isPlaying) {
                    audio.play()
                        .then(() => setIsPlaying(true))
                        .catch(e => console.log('Play error:', e));
                }
            });
        } else if (trackUrl) {
            audio.src = trackUrl;
            audio.load();
            setIsLoading(false);
            if (isPlaying) {
                audio.play()
                    .then(() => setIsPlaying(true))
                    .catch(e => console.log('Play error:', e));
            }
        }

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }
        };
    }, [currentTrack]);

    useEffect(() => {
        if (!audioRef.current || !currentTrack) return;
        
        if (isPlaying) {
            audioRef.current.play().catch(e => console.log('Play error:', e));
        } else {
            audioRef.current.pause();
        }
    }, [isPlaying, currentTrack]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

    useEffect(() => {
        if (roomTracks.length > 0 && roomIsShuffled) {
            const indices = Array.from({ length: roomTracks.length }, (_, i) => i);
            setRoomShuffledIndices(shuffleArray(indices));
        } else if (roomTracks.length > 0) {
            setRoomShuffledIndices(Array.from({ length: roomTracks.length }, (_, i) => i));
        }
    }, [roomIsShuffled, roomTracks]);

    useEffect(() => {
        if (currentPlaylist && currentPlaylist.tracks) {
            const filtered = currentPlaylist.tracks.filter(track =>
                track.title?.toLowerCase().includes(vkSearchTerm.toLowerCase()) ||
                track.artist?.toLowerCase().includes(vkSearchTerm.toLowerCase())
            );
            setFilteredVkTracks(filtered);
        }
    }, [vkSearchTerm, currentPlaylist]);

    useEffect(() => {
        if (isAuthenticated && currentUserId) {
            fetchMusicData();
            loadRooms();
            loadMusicStats();
            saveAppState();
        }
    }, [isAuthenticated, currentUserId]);

    useEffect(() => {
        const initializeApp = async () => {
            await loadAppState();
            setIsInitializing(false);
        };
        
        initializeApp();
    }, []);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (votingTimerRef.current) {
                clearInterval(votingTimerRef.current);
            }
        };
    }, []);

    // Components
    const TrackCover = ({ track, size = 'small', className }) => {
        const [imgError, setImgError] = useState(false);
        const coverUrl = getCoverUrl(track, size);

        return (
            <div className={`track-cover-wrapper ${className}`}>
                {coverUrl && !imgError ? (
                    <img
                        src={coverUrl}
                        alt={track?.title || 'Обложка'}
                        className={`track-cover-img ${size}`}
                        onError={() => setImgError(true)}
                    />
                ) : (
                    <div className={`track-cover-placeholder ${size}`}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                        </svg>
                    </div>
                )}
            </div>
        );
    };

    const PlaylistCover = ({ playlist, className }) => {
        const [imgError, setImgError] = useState(false);

        return (
            <div className={`playlist-cover-wrapper ${className}`}>
                {playlist?.cover_url && !imgError ? (
                    <img
                        src={playlist.cover_url}
                        alt={playlist?.title || 'Плейлист'}
                        className="playlist-cover-img"
                        onError={() => setImgError(true)}
                    />
                ) : (
                    <div className="playlist-cover-placeholder">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                        </svg>
                    </div>
                )}
            </div>
        );
    };

    const MusicParserModal = () => {
        const getStatusText = (status) => {
            const statusMap = {
                'idle': 'Готов к работе',
                'parsing_tracks': 'Получение треков...',
                'saving_tracks': 'Сохранение треков...',
                'parsing_playlists': 'Получение плейлистов...',
                'exporting': 'Экспорт данных...',
                'completed': 'Завершено!',
                'error': 'Ошибка'
            };
            return statusMap[status] || status;
        };

        return (
            <div className="music-parser-modal">
                <div className="parser-content">
                    <div className="parser-header">
                        <h3>🎵 Синхронизация музыки VK</h3>
                        <button className="close-parser-btn" onClick={() => setShowMusicParser(false)}>✕</button>
                    </div>

                    {musicStats && (
                        <div className="parser-stats">
                            <h4>📊 Статистика</h4>
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <div className="stat-value">{musicStats.total_tracks || 0}</div>
                                    <div className="stat-label">Всего треков</div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-value">{musicStats.total_playlists || 0}</div>
                                    <div className="stat-label">Плейлистов</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {isParsing ? (
                        <div className="parsing-progress">
                            <h4>🔄 Парсинг музыки...</h4>
                            <div className="progress-bar">
                                <div className="progress-fill" style={{ width: `${parseProgress}%` }}>
                                    {Math.round(parseProgress)}%
                                </div>
                            </div>
                            <div className="progress-text">{getStatusText(parseStatus)}</div>
                        </div>
                    ) : (
                        <div className="parser-actions">
                            <button onClick={startParsing} className="start-parsing-btn">
                                🚀 Начать синхронизацию
                            </button>
                            <p className="parser-info">
                                Синхронизация загрузит все ваши треки и плейлисты из VK.<br/>
                                Это может занять несколько минут.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Loading screen
    if (isInitializing) {
        return (
            <div className="loading-container">
                <div className="loading-spinner"></div>
                <p>Загрузка приложения...</p>
            </div>
        );
    }

    // Auth screen
    if (!isAuthenticated) {
        return (
            <div className="auth-container">
                <div className="auth-card">
                    <div className="auth-header">
                        <div className="auth-icon">🎵</div>
                        <h1>VK Music Player</h1>
                        <p>Войдите с помощью VK токена</p>
                    </div>
                    
                    <div className="auth-instructions">
                        <h3>📖 Как получить токен:</h3>
                        <ol className="instruction-steps">
                            <li>
                                <span className="step-number">1</span>
                                <div className="step-content">
                                    <strong>Перейдите на сайт</strong>
                                    <a href="https://vkhost.github.io/" target="_blank" rel="noopener noreferrer" className="vkhost-link">
                                        vkhost.github.io
                                    </a>
                                </div>
                            </li>
                            <li>
                                <span className="step-number">2</span>
                                <div className="step-content">
                                    <strong>Выберите разрешения:</strong>
                                    <ul className="permissions-list">
                                        <li>📁 <code>audio</code> - доступ к аудиозаписям</li>
                                        <li>📋 <code>wall</code> - доступ к стене</li>
                                        <li>👤 <code>friends</code> - доступ к друзьям</li>
                                    </ul>
                                </div>
                            </li>
                            <li>
                                <span className="step-number">3</span>
                                <div className="step-content">
                                    <strong>Нажмите "Получить токен"</strong>
                                </div>
                            </li>
                            <li>
                                <span className="step-number">4</span>
                                <div className="step-content">
                                    <strong>Скопируйте токен</strong>
                                </div>
                            </li>
                            <li>
                                <span className="step-number">5</span>
                                <div className="step-content">
                                    <strong>Вставьте токен ниже и нажмите "Войти"</strong>
                                </div>
                            </li>
                        </ol>
                        
                        <div className="auth-note">
                            <span className="note-icon">⚠️</span>
                            <p>Токен хранится только в вашем браузере. Никогда не передавайте его другим!</p>
                        </div>
                    </div>
                    
                    <div className="auth-form">
                        <input
                            type="text"
                            className="token-input"
                            placeholder="Вставьте VK токен"
                            value={tokenInput}
                            onChange={(e) => {
                                setTokenInput(e.target.value);
                                setAuthError('');
                            }}
                            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                        />
                        
                        {authError && (
                            <div className="auth-error">
                                ❌ {authError}
                            </div>
                        )}
                        
                        <button 
                            className={`login-btn ${isVerifying ? 'loading' : ''}`}
                            onClick={handleLogin}
                            disabled={isVerifying}
                        >
                            {isVerifying ? '⏳ Проверка...' : '🎧 Войти'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Main app
    return (
        <div className="vk-music-app">
            <div className="top-buttons">
                <button className="logout-btn" onClick={handleLogout} title="Выйти">
                    🚪 Выйти
                </button>
                {!currentRoom && (
                    <button className="sync-music-btn" onClick={() => setShowMusicParser(true)} title="Синхронизация музыки">
                        🎵 Синхронизация
                    </button>
                )}
            </div>
            
            {showMusicParser && <MusicParserModal />}

            {/* Create Room Modal */}
            {showCreateRoomModal && (
                <div className="modal-overlay" onClick={() => setShowCreateRoomModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>Создать комнату</h3>
                        <input
                            type="text"
                            placeholder="Название комнаты"
                            value={roomName}
                            onChange={(e) => setRoomName(e.target.value)}
                            className="room-name-input"
                        />
                        
                        <div className="scenario-selection">
                            <label className="scenario-label">Сценарий:</label>
                            <div className="scenario-options">
                                <label className={`scenario-option ${roomScenario === 'withVoting' ? 'selected' : ''}`}>
                                    <input
                                        type="radio"
                                        value="withVoting"
                                        checked={roomScenario === 'withVoting'}
                                        onChange={(e) => setRoomScenario(e.target.value)}
                                    />
                                    <div className="scenario-content">
                                        <span className="scenario-icon">🗳️</span>
                                        <div>
                                            <strong>С голосованием</strong>
                                            <p>Треки добавляются после голосования</p>
                                        </div>
                                    </div>
                                </label>
                                
                                <label className={`scenario-option ${roomScenario === 'withoutVoting' ? 'selected' : ''}`}>
                                    <input
                                        type="radio"
                                        value="withoutVoting"
                                        checked={roomScenario === 'withoutVoting'}
                                        onChange={(e) => setRoomScenario(e.target.value)}
                                    />
                                    <div className="scenario-content">
                                        <span className="scenario-icon">🎵</span>
                                        <div>
                                            <strong>Без голосования</strong>
                                            <p>Треки добавляются сразу</p>
                                        </div>
                                    </div>
                                </label>
                            </div>
                        </div>
                        
                        <div className="modal-buttons">
                            <button onClick={createRoom} className="create-room-btn">Создать</button>
                            <button onClick={() => setShowCreateRoomModal(false)} className="cancel-btn">Отмена</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Save Playlist Modal */}
            {showSavePlaylistModal && (
                <div className="modal-overlay" onClick={() => setShowSavePlaylistModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>💾 Сохранить плейлист</h3>
                        <p>Сохранить плейлист комнаты <strong>"{currentRoom?.name}"</strong></p>
                        <p><strong>{roomTracks.length}</strong> треков</p>
                        
                        <input
                            type="text"
                            placeholder="Название плейлиста"
                            value={newPlaylistName}
                            onChange={(e) => {
                                setNewPlaylistName(e.target.value);
                                setSavePlaylistError('');
                            }}
                            className="room-name-input"
                            autoFocus
                        />
                        
                        {savePlaylistError && (
                            <div className="error-message" style={{ color: 'red', fontSize: '12px', marginTop: '5px' }}>
                                {savePlaylistError}
                            </div>
                        )}
                        
                        <div className="modal-buttons">
                            <button onClick={saveRoomPlaylist} className="create-room-btn">💾 Сохранить</button>
                            <button onClick={() => {
                                setShowSavePlaylistModal(false);
                                setNewPlaylistName('');
                                setSavePlaylistError('');
                            }} className="cancel-btn">Отмена</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Voting Modal */}
            {showVotingModal && votingTrack && (
                <div className="modal-overlay">
                    <div className="modal-content voting-modal">
                        <h3>🗳️ Голосование за трек</h3>
                        
                        <div className="voting-track-info">
                            <TrackCover track={votingTrack} size="small" />
                            <div>
                                <div className="voting-track-title">{votingTrack.title}</div>
                                <div className="voting-track-artist">{votingTrack.artist}</div>
                                <div className="voting-proposed-by">Предложил: {votingProposedBy}</div>
                            </div>
                        </div>
                        
                        <div className="voting-options">
                            <button
                                className={`vote-btn ${userVote === 'yes' ? 'voted' : ''}`}
                                onClick={() => castVote('yes')}
                                disabled={userVote !== null}
                            >
                                ✅ За ({votesYes})
                            </button>
                            
                            <button
                                className={`vote-btn ${userVote === 'no' ? 'voted' : ''}`}
                                onClick={() => castVote('no')}
                                disabled={userVote !== null}
                            >
                                ❌ Против ({votesNo})
                            </button>
                        </div>
                        
                        <div className="voting-stats">
                            <div className="vote-progress">
                                <div 
                                    className="vote-bar yes" 
                                    style={{
                                        width: (votesYes + votesNo) > 0
                                            ? `${(votesYes / (votesYes + votesNo)) * 100}%`
                                            : '0%'
                                    }}
                                />
                            </div>
                            <div className="vote-percent">
                                {(votesYes + votesNo) > 0
                                    ? `${Math.round((votesYes / (votesYes + votesNo)) * 100)}%`
                                    : '0%'} ЗА
                            </div>
                        </div>
                        
                        <div className="voting-info">
                            <p>⏰ Осталось времени: {votingTimer} сек</p>
                            <p>👥 Проголосовало: {totalVoted} из {totalParticipants}</p>
                            <p>✔️ Трек будет добавлен только если голосов "ЗА" больше чем "ПРОТИВ"</p>
                            <p>⚖️ При равном количестве голосов трек НЕ добавляется</p>
                        </div>
                        
                        <div className="modal-buttons">
                            <button onClick={() => setShowVotingModal(false)} className="cancel-btn">
                                Закрыть
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Room Confirm Modal */}
            {showDeleteConfirmModal && roomToDelete && (
                <div className="modal-overlay" onClick={() => setShowDeleteConfirmModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>Удалить комнату?</h3>
                        <p>Удалить комнату <strong>"{roomToDelete.name}"</strong>?</p>
                        <p>Это действие нельзя отменить.</p>
                        <div className="modal-buttons">
                            <button onClick={deleteRoom} className="delete-confirm-btn">Удалить</button>
                            <button onClick={() => setShowDeleteConfirmModal(false)} className="cancel-btn">Отмена</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Playlists Sidebar */}
            <div className={`playlists-sidebar ${showPlaylistSidebar ? 'visible' : 'hidden'}`}>
                <div className="sidebar-header">
                    <h3>Мои плейлисты</h3>
                    <button className="toggle-sidebar-btn" onClick={() => setShowPlaylistSidebar(!showPlaylistSidebar)}>
                        {showPlaylistSidebar ? '◀' : '▶'}
                    </button>
                </div>

                <div className="playlists-list">
                    {playlists.map((playlist) => (
                        <div
                            key={playlist.id}
                            className={`playlist-item ${currentPlaylist?.id === playlist.id ? 'active' : ''}`}
                            onClick={() => switchPlaylist(playlist)}
                        >
                            <PlaylistCover playlist={playlist} />
                            <div className="playlist-info">
                                <div className="playlist-title">
                                    {playlist.is_main && '⭐ '}
                                    {playlist.is_user_created && '💾 '}
                                    {playlist.title}
                                </div>
                                <div className="playlist-count">
                                    {playlist.actual_count || playlist.tracks?.length || 0} треков
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Navigation Buttons */}
            {!showPlaylistSidebar && !currentRoom && (
                <button className="show-sidebar-btn" onClick={() => setShowPlaylistSidebar(true)}>
                    📋 Плейлисты
                </button>
            )}

            {!showMakeRoom && !currentRoom && (
                <button className="show-sidebar-btn2" onClick={() => setShowMakeRoom(true)}>
                    🎵 Комнаты
                </button>
            )}

            {/* Rooms Panel */}
            {showMakeRoom && !currentRoom && (
                <div className="rooms-panel">
                    <div className="rooms-header">
                        <h3>Музыкальные комнаты</h3>
                        <button onClick={() => setShowCreateRoomModal(true)} className="create-room-btn">
                            + Создать
                        </button>
                        <button onClick={() => setShowMakeRoom(false)} className="close-rooms-btn">
                            ✕
                        </button>
                    </div>
                    <div className="rooms-list">
                        {rooms.length === 0 ? (
                            <div className="empty-rooms">Нет созданных комнат</div>
                        ) : (
                            rooms.map(room => (
                                <div key={room.id} className="room-card">
                                    <div className="room-info">
                                        <h4>{room.name}</h4>
                                        <p>Создатель: {room.creator}</p>
                                        <p>👥 {room.participants.length} участников</p>
                                        <p>🎵 {room.tracks?.length || 0} треков</p>
                                        <p className="room-scenario-badge">
                                            {room.scenario === 'withVoting' ? '🗳️ С голосованием' : '🎵 Без голосования'}
                                        </p>
                                    </div>
                                    <div className="room-buttons">
                                        <button onClick={() => joinRoom(room)} className="join-room-btn">
                                            Войти
                                        </button>
                                        {room.creator === currentUsername && (
                                            <button onClick={() => {
                                                setRoomToDelete(room);
                                                setShowDeleteConfirmModal(true);
                                            }} className="delete-room-btn" title="Удалить">
                                                🗑️
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Room Interface */}
            {currentRoom && (
                <div className="room-interface">
                    <div className="room-header">
                        <div className="room-header-left">
                            <h2>🎵 {currentRoom.name}</h2>
                            <span className="room-scenario-badge-header">
                                {currentRoom.scenario === 'withVoting' ? '🗳️ Голосование' : '🎵 Без голосования'}
                            </span>
                            {currentRoom.creator === currentUsername && (
                                <button onClick={() => {
                                    setRoomToDelete(currentRoom);
                                    setShowDeleteConfirmModal(true);
                                }} className="delete-room-btn-header">
                                    🗑️ Удалить
                                </button>
                            )}
                        </div>
                        <div className="room-header-right">
                            
                            <button onClick={leaveRoom} className="leave-room-btn">
                                🚪 Выйти
                            </button>
                        </div>
                    </div>

                    <div className="room-content">
                        {/* Participants */}
                        <div className="room-participants">
                            <h3>👥 Участники ({participants.length})</h3>
                            <div className="participants-list">
                                {participants.map(participant => (
                                    <div key={participant.id} className="participant-item">
                                        <span className="participant-name">
                                            {participant.name}
                                            {participant.isCreator && ' 👑'}
                                            {participant.id === currentUserId && ' (Вы)'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Chat */}
                        {showChat && (
                            <div className="room-chat">
                                <div className="chat-header">
                                    <h3>💬 Чат</h3>
                                    <button className="toggle-chat-btn" onClick={() => setShowChat(false)}>✕</button>
                                </div>
                                <div className="chat-messages">
                                    {chatMessages.map((msg, idx) => (
                                        <div key={idx} className={`chat-message ${msg.user_id === 'system' ? 'system' : ''}`}>
                                            <span className="message-user">{msg.user_name}:</span>
                                            <span className="message-text">{msg.message}</span>
                                            <span className="message-time">
                                                {new Date(msg.timestamp).toLocaleTimeString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="chat-input">
                                    <input
                                        type="text"
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                                        placeholder="Напишите сообщение..."
                                    />
                                    <button onClick={sendChatMessage}>📤</button>
                                </div>
                            </div>
                        )}

                        {!showChat && (
                            <button className="show-chat-btn" onClick={() => setShowChat(true)}>
                                💬 Чат
                            </button>
                        )}

                        {/* Tracks Container */}
                        <div className="room-tracks-container">
                            {/* VK Tracks */}
                            <div className="vk-tracks-section">
                                <div className="section-header">
                                    <h3>🔍 Поиск песен</h3>
                                    <div className="search-box">
                                        <input
                                            type="text"
                                            placeholder="Поиск..."
                                            value={vkSearchTerm}
                                            onChange={(e) => setVkSearchTerm(e.target.value)}
                                            className="search-input-vk"
                                        />
                                    </div>
                                </div>
                                <div className="tracks-list-vk">
                                    {filteredVkTracks.length > 0 ? (
                                        filteredVkTracks.map((track, index) => {
                                            const isInRoom = roomTracks.some(t => t.id === track.id || t.vk_id === track.vk_id);
                                            return (
                                                <div key={track.id || track.vk_id || index} className="vk-track-item">
                                                    <div className="track-info">
                                                        <TrackCover track={track} size="small" />
                                                        <div className="track-details">
                                                            <div className="track-title">{track.title || 'Без названия'}</div>
                                                            <div className="track-artist">{track.artist || 'Неизвестный'}</div>
                                                        </div>
                                                    </div>
                                                    <button 
                                                        className={`add-to-room-btn ${isInRoom ? 'disabled' : ''}`}
                                                        onClick={() => !isInRoom && startVoting(track)}
                                                        disabled={isInRoom}
                                                    >
                                                        {isInRoom ? '✓ Добавлен' : (currentRoom.scenario === 'withVoting' ? '🗳️' : '+')}
                                                    </button>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="empty-tracks">
                                            {vkSearchTerm ? 'Песни не найдены' : 'Введите текст для поиска'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Room Playlist */}
                            <div className="room-tracks-section">
                                <div className="section-header">
                                    <div className="header-top">
                                        <h3>🎵 Плейлист ({roomTracks.length})</h3>
                                        <div className="room-player-controls-header">
                                            <button
                                                className={`room-control-btn-small ${roomRepeatMode === 'one' ? 'active' : ''}`}
                                                onClick={() => setRoomRepeatMode(roomRepeatMode === 'one' ? 'off' : 'one')}
                                                title="Повтор трека"
                                            >
                                                🔂
                                            </button>
                                            <button
                                                className={`room-control-btn-small ${roomRepeatMode === 'all' ? 'active' : ''}`}
                                                onClick={() => setRoomRepeatMode(roomRepeatMode === 'all' ? 'off' : 'all')}
                                                title="Повтор плейлиста"
                                            >
                                                🔁
                                            </button>
                                            <button
                                                className={`room-control-btn-small ${roomIsShuffled ? 'active' : ''}`}
                                                onClick={() => setRoomIsShuffled(!roomIsShuffled)}
                                                title="Перемешать"
                                            >
                                                🔀
                                            </button>
                                        </div>
                                    </div>
                                    <div className="search-box">
                                        <input
                                            type="text"
                                            placeholder="Поиск в плейлисте..."
                                            value={roomSearchTerm}
                                            onChange={(e) => setRoomSearchTerm(e.target.value)}
                                            className="search-input-room"
                                        />
                                    </div>
                                </div>
                                <div className="tracks-list-room">
                                    {roomTracks.filter(track =>
                                        track.title?.toLowerCase().includes(roomSearchTerm.toLowerCase()) ||
                                        track.artist?.toLowerCase().includes(roomSearchTerm.toLowerCase())
                                    ).length > 0 ? (
                                        roomTracks.filter(track =>
                                            track.title?.toLowerCase().includes(roomSearchTerm.toLowerCase()) ||
                                            track.artist?.toLowerCase().includes(roomSearchTerm.toLowerCase())
                                        ).map((track, idx) => {
                                            const originalIndex = roomTracks.findIndex(t => t.id === track.id || t.vk_id === track.vk_id);
                                            const displayIndex = roomIsShuffled ? roomShuffledIndices.findIndex(i => i === originalIndex) : originalIndex;
                                            const isActive = currentTrack?.id === track.id || currentTrack?.vk_id === track.vk_id;
                                            
                                            return (
                                                <div 
                                                    key={track.id || track.vk_id || idx} 
                                                    className={`room-track-item ${isActive ? 'active' : ''}`}
                                                >
                                                    <div 
                                                        className="track-info" 
                                                        onClick={() => playTrackFromRoom(track, displayIndex)}
                                                    >
                                                        <div className="track-number">
                                                            {isActive && isPlaying ? '🎵' : (displayIndex + 1)}
                                                        </div>
                                                        <TrackCover track={track} size="small" />
                                                        <div className="track-details">
                                                            <div className="track-title">{track.title || 'Без названия'}</div>
                                                            <div className="track-artist">{track.artist || 'Неизвестный'}</div>
                                                            <div className="track-added-by">➕ {track.added_by}</div>
                                                        </div>
                                                        <div className="track-duration">
                                                            {formatTime(track.duration)}
                                                        </div>
                                                    </div>
                                                    {(track.added_by_id === currentUserId || participants.find(p => p.id === currentUserId && p.isCreator)) && (
                                                        <button 
                                                            onClick={() => removeTrackFromRoom(track.id || track.vk_id)}
                                                            className="remove-track-btn"
                                                            title="Удалить"
                                                        >
                                                            🗑️
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="empty-tracks">
                                            {roomSearchTerm ? 'Песни не найдены' : 'Нет песен. Добавьте из левого списка!'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Player */}
                    <div className="room-player">
                        <div className="room-player-content">
                            <div className="room-player-track-info">
                                <TrackCover track={currentTrack} size="small" className="room-player-cover" />
                                <div className="room-player-track-details">
                                    <div className="room-player-track-title">
                                        {currentTrack?.title || 'Выберите трек'}
                                    </div>
                                    <div className="room-player-track-artist">
                                        {currentTrack?.artist || 'Нажмите на песню'}
                                    </div>
                                </div>
                            </div>

                            <audio
                                ref={audioRef}
                                onTimeUpdate={() => {
                                    if (audioRef.current) {
                                        setCurrentTime(audioRef.current.currentTime);
                                        setDuration(audioRef.current.duration);
                                    }
                                }}
                                onEnded={nextTrack}
                            />

                            <div className="room-player-controls">
                                <div className="room-control-group">
                                    <button
                                        className="room-control-btn"
                                        onClick={prevTrack}
                                        disabled={!currentTrack || roomTracks.length === 0}
                                        title="Предыдущий"
                                    >
                                        ⏮️
                                    </button>

                                    <button
                                        className="room-control-btn room-play-btn"
                                        onClick={isPlaying ? pauseTrack : () => {
                                            if (currentTrack) {
                                                setIsPlaying(true);
                                                if (audioRef.current) audioRef.current.play();
                                            }
                                        }}
                                        disabled={!currentTrack || isLoading}
                                    >
                                        {isLoading ? '⏳' : (isPlaying ? '⏸️' : '▶️')}
                                    </button>

                                    <button
                                        className="room-control-btn"
                                        onClick={nextTrack}
                                        disabled={!currentTrack || roomTracks.length === 0}
                                        title="Следующий"
                                    >
                                        ⏭️
                                    </button>
                                </div>

                                <div className="room-progress-container">
                                    <span className="room-time">{formatTime(currentTime)}</span>
                                    <input
                                        type="range"
                                        className="room-progress-bar"
                                        value={currentTime}
                                        max={duration || 0}
                                        onChange={handleSeek}
                                        disabled={!currentTrack}
                                    />
                                    <span className="room-time">{formatTime(duration)}</span>
                                </div>

                                <div className="room-volume-container">
                                    <span>🔊</span>
                                    <input
                                        type="range"
                                        className="room-volume-slider"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={volume}
                                        onChange={(e) => {
                                            const newVolume = parseFloat(e.target.value);
                                            setVolume(newVolume);
                                            if (audioRef.current) {
                                                audioRef.current.volume = newVolume;
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Player (outside room) */}
            {!currentRoom && (
                <div className="main-player">
                    <div className="player-container">
                        <div className="current-playlist-info">
                            <PlaylistCover playlist={currentPlaylist} className="current-playlist-cover" />
                            <div className="playlist-details">
                                <h3>{currentPlaylist?.title || 'Выберите плейлист'}</h3>
                                {currentPlaylist?.description && <p>{currentPlaylist.description}</p>}
                            </div>
                        </div>
                        <div className="playlist">
                            <div className="search-container">
                                <input
                                    type="text"
                                    placeholder={`Поиск в "${currentPlaylist?.title || ''}"...`}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="search-input"
                                />
                            </div>
                            <div className="tracks-list">
                                {tracks.filter(track =>
                                    track.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                    track.artist?.toLowerCase().includes(searchTerm.toLowerCase())
                                ).length > 0 ? (
                                    tracks.filter(track =>
                                        track.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                        track.artist?.toLowerCase().includes(searchTerm.toLowerCase())
                                    ).map((track, displayIndex) => (
                                        <div key={track.id || track.vk_id || displayIndex} className="track-item">
                                            <TrackCover track={track} size="small" />
                                            <div className="track-details">
                                                <div className="track-title">{track.title || 'Без названия'}</div>
                                                <div className="track-artist">{track.artist || 'Неизвестный'}</div>
                                            </div>
                                            <div className="track-duration">
                                                {formatTime(track.duration)}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="empty-playlist">
                                        {searchTerm ? 'Треки не найдены' : 'Плейлист пуст'}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VKMusicPlayer;