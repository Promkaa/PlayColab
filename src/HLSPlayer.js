'use client';

import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

// Настройки для оптимальной работы с HLS-потоками
const HLS_CONFIG = {
    maxBufferLength: 15,          // Максимальная длина буфера в секундах (меньше - быстрее старт)
    maxMaxBufferLength: 30,       // Абсолютный максимум буфера
    maxBufferSize: 30 * 1000000,  // 30MB максимум данных в буфере
    abrBandWidthUpFactor: 0.5,    // Плавное повышение качества (избегает скачков)
    fragLoadingMaxRetry: 6,       // Количество повторных попыток при загрузке фрагмента
    manifestLoadingMaxRetry: 4,   // Количество повторных попыток при загрузке манифеста
};

const HLSPlayer = ({ src, poster, autoPlay = false }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return;

        // Функция для очистки предыдущего экземпляра HLS
        const destroyHls = () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };

        // Проверяем, поддерживает ли браузер HLS через hls.js
        if (Hls.isSupported()) {
            destroyHls();

            const hls = new Hls(HLS_CONFIG);
            hlsRef.current = hls;

            // Загружаем HLS-поток и прикрепляем к элементу <video>
            hls.loadSource(src);
            hls.attachMedia(video);

            // Автовоспроизведение после загрузки манифеста
            if (autoPlay) {
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().catch(e => console.log('Автовоспроизведение заблокировано:', e));
                });
            }

            // Обработка критических ошибок для восстановления
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.warn('Сетевая ошибка, попытка восстановления...');
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.warn('Медиа-ошибка, попытка восстановления...');
                            hls.recoverMediaError();
                            break;
                        default:
                            console.error('Неустранимая ошибка, пересоздание плеера');
                            destroyHls();
                            break;
                    }
                }
            });
        }
        // Для Safari, который поддерживает HLS нативно
        else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src;
            if (autoPlay) video.play().catch(e => console.log('Автовоспроизведение заблокировано:', e));
        }

        // Очистка при размонтировании компонента
        return destroyHls;
    }, [src, autoPlay]);

    return (
        <video
            ref={videoRef}
            controls
            poster={poster}
            className="hls-player"
            style={{ width: '100%', maxWidth: '800px' }}
            playsInline
        />
    );
};

export default HLSPlayer;