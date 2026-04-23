# Создание БД
```
-- Database: music.db

-- DROP DATABASE IF EXISTS "music.db";

CREATE DATABASE "music.db"

    WITH
    
    OWNER = postgres
    
    ENCODING = 'UTF8'
    
    LC_COLLATE = 'ru-RU'
    
    LC_CTYPE = 'ru-RU'
    
    LOCALE_PROVIDER = 'libc'
    
    TABLESPACE = pg_default
    
    CONNECTION LIMIT = -1
    
    IS_TEMPLATE = False;

COMMENT ON DATABASE "music.db"

    IS 'База данных для хранения названий, авторов, метаданных и пути трека на диске';
```
## Таблицы
### Таблица музыки, которая работает с backend'ом
```
-- Table: public.music_tracks

-- DROP TABLE IF EXISTS public.music_tracks;

CREATE TABLE IF NOT EXISTS public.music_tracks
(
    id integer NOT NULL DEFAULT nextval('music_tracks_id_seq'::regclass),
    title character varying(255) COLLATE pg_catalog."default" NOT NULL,
    audio_data bytea NOT NULL,
    CONSTRAINT music_tracks_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.music_tracks
    OWNER to postgres;
```

### Пользователи
```

-- Table: public.users

-- DROP TABLE IF EXISTS public.users;

CREATE TABLE IF NOT EXISTS public.users
(

    id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
    
    login text COLLATE pg_catalog."default" NOT NULL,
    
    device_id text COLLATE pg_catalog."default" NOT NULL,
    
    CONSTRAINT users_pkey PRIMARY KEY (id),
    
    CONSTRAINT users_device_id_key UNIQUE (device_id)
    
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.users

    OWNER to postgres;

```

### треки
```

-- Table: public.tracks

-- DROP TABLE IF EXISTS public.tracks;

CREATE TABLE IF NOT EXISTS public.tracks

(

    id integer NOT NULL DEFAULT nextval('tracks_id_seq'::regclass),
    
    nametrack text COLLATE pg_catalog."default" NOT NULL,
    
    duration integer,
    
    filepath text COLLATE pg_catalog."default" NOT NULL,
    
    genre text COLLATE pg_catalog."default" NOT NULL,
    
    CONSTRAINT tracks_pkey PRIMARY KEY (id)
    
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.tracks

    OWNER to postgres;
```

### Сессии
```

-- Table: public.sessions

-- DROP TABLE IF EXISTS public.sessions;

CREATE TABLE IF NOT EXISTS public.sessions

(
    id integer NOT NULL DEFAULT nextval('sessions_id_seq'::regclass),
    
    host_token text COLLATE pg_catalog."default" NOT NULL,
    
    name text COLLATE pg_catalog."default",
    
    is_active boolean DEFAULT true,
    
    CONSTRAINT sessions_pkey PRIMARY KEY (id),
    
    CONSTRAINT sessions_host_token_key UNIQUE (host_token)
    
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.sessions

    OWNER to postgres;
```

### Плейлисты
```

-- Table: public.playlists

-- DROP TABLE IF EXISTS public.playlists;

CREATE TABLE IF NOT EXISTS public.playlists

(

    id integer NOT NULL DEFAULT nextval('playlists_id_seq'::regclass),
    
    session_id integer NOT NULL,
    
    is_current boolean DEFAULT false,
    
    CONSTRAINT playlists_pkey PRIMARY KEY (id),
    
    CONSTRAINT playlists_session_id_fkey FOREIGN KEY (session_id)
    
        REFERENCES public.sessions (id) MATCH SIMPLE

        ON UPDATE NO ACTION
        
        ON DELETE CASCADE
        
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.playlists

    OWNER to postgres;
    
```

### Playlist_items

```

-- Table: public.playlist_items

-- DROP TABLE IF EXISTS public.playlist_items;

CREATE TABLE IF NOT EXISTS public.playlist_items

(
    id integer NOT NULL DEFAULT nextval('playlist_items_id_seq'::regclass),
    
    playlist_id integer NOT NULL,
    
    track_id integer NOT NULL,
    
    user_id integer NOT NULL,
    
    "position" integer NOT NULL,
    
    added_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT playlist_items_pkey PRIMARY KEY (id),
    
    CONSTRAINT playlist_items_playlist_id_fkey FOREIGN KEY (playlist_id)
    
        REFERENCES public.playlists (id) MATCH SIMPLE
        
        ON UPDATE NO ACTION
        
        ON DELETE CASCADE,
        
    CONSTRAINT playlist_items_track_id_fkey FOREIGN KEY (track_id)
    
        REFERENCES public.tracks (id) MATCH SIMPLE

        ON UPDATE NO ACTION
        
        ON DELETE CASCADE,
        
    CONSTRAINT playlist_items_user_id_fkey FOREIGN KEY (user_id)
    
        REFERENCES public.users (id) MATCH SIMPLE

        ON UPDATE NO ACTION
        
        ON DELETE CASCADE
        
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.playlist_items

    OWNER to postgres;
    
```
