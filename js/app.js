const PB_URL = "https://pocketbase-railway-production-e2c8.up.railway.app"; 
const pb = new PocketBase(PB_URL);

let currentSongsList = [];
let currentIndex = 0;
let isRegistering = false;
let isShuffleActive = false;
let currentRoomId = null;
let isRemoteAction = false; // Bandera para evitar bucles en Jam
const CACHE_NAME = "salvamusic-offline-v5";

document.addEventListener("DOMContentLoaded", () => {
    if (pb.authStore.isValid) {
        showApp();
    } else {
        showAuth();
    }
    updateOfflineCount();
    loadCustomPlaylists();
    setupAudioListeners();
});

function toggleAuthMode() {
    isRegistering = !isRegistering;
    if (isRegistering) {
        document.getElementById("auth-title").textContent = "Crear Cuenta";
        document.getElementById("auth-btn").textContent = "Registrarse";
        document.getElementById("auth-switch-text").textContent = "¿Ya tienes cuenta?";
        document.getElementById("auth-switch-btn").textContent = "Inicia sesión";
    } else {
        document.getElementById("auth-title").textContent = "Iniciar Sesión";
        document.getElementById("auth-btn").textContent = "Entrar";
        document.getElementById("auth-switch-text").textContent = "¿No tienes cuenta?";
        document.getElementById("auth-switch-btn").textContent = "Regístrate";
    }
}

document.getElementById("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
        if (isRegistering) {
            await pb.collection('users').create({ email, password, passwordConfirm: password });
            await pb.collection('users').authWithPassword(email, password);
            alert("¡Cuenta creada con éxito!");
        } else {
            await pb.collection('users').authWithPassword(email, password);
        }
        showApp();
    } catch (error) {
        console.error("Error de autenticación:", error);
        alert("Correo o contraseña incorrectos. Verifica tus datos.");
    }
});

function logout() {
    pb.authStore.clear();
    showAuth();
}

function showAuth() {
    document.getElementById("auth-container").classList.remove("hidden");
    document.getElementById("app-container").classList.add("hidden");
    document.getElementById("audio-player-bar").classList.add("hidden");
}

function showApp() {
    document.getElementById("auth-container").classList.add("hidden");
    document.getElementById("app-container").classList.remove("hidden");
    document.getElementById("user-display").textContent = pb.authStore.model.email;
    loadSongs();
}

function switchTab(tabName) {
    document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.remove("bg-emerald-500", "text-zinc-950");
        btn.classList.add("bg-zinc-900", "text-zinc-300", "border", "border-zinc-800");
    });
    document.getElementById(`tab-${tabName}`).classList.remove("hidden");
    event.currentTarget.classList.remove("bg-zinc-900", "text-zinc-300", "border", "border-zinc-800");
    event.currentTarget.classList.add("bg-emerald-500", "text-zinc-950");

    if (tabName === 'playlists') {
        loadCustomPlaylists();
    }
}

async function loadSongs() {
    const songsListContainer = document.getElementById("songs-list");
    try {
        const userId = pb.authStore.model.id;
        const records = await pb.collection('songs').getList(1, 50, {
            filter: `uploaded_by = "${userId}"`,
            sort: '-created',
        });
        currentSongsList = records.items;

        document.getElementById("library-count").textContent = `${currentSongsList.length} canciones disponibles`;

        if (currentSongsList.length === 0) {
            songsListContainer.innerHTML = `<p class="text-zinc-500 text-center py-6 text-xs">Tu biblioteca personal está vacía. Sube tu música.</p>`;
            return;
        }

        renderSongsList(currentSongsList);
    } catch (error) {
        console.error("Error al cargar canciones:", error);
    }
}

function renderSongsList(songs) {
    const songsListContainer = document.getElementById("songs-list");
    songsListContainer.innerHTML = "";

    songs.forEach((song, index) => {
        const coverUrl = song.cover ? pb.files.getUrl(song, song.cover) : null;
        const audioUrl = pb.files.getUrl(song, song.audio_file);

        const songDiv = document.createElement("div");
        songDiv.className = "flex items-center justify-between bg-zinc-900 p-3 rounded-xl border border-zinc-800 hover:border-zinc-700 transition";
        songDiv.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden cursor-pointer flex-grow" onclick="playSongByIndex(${index})">
                <div class="w-12 h-12 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center text-zinc-500">
                    ${coverUrl ? `<img src="${coverUrl}" class="w-full h-full object-cover">` : '<i class="fa-solid fa-music"></i>'}
                </div>
                <div class="truncate">
                    <h4 class="text-sm font-semibold text-zinc-100 truncate">${song.title}</h4>
                    <p class="text-xs text-zinc-400 truncate">${song.artist}</p>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                <button onclick="toggleDownloadOffline('${audioUrl}', '${song.title}')" class="w-9 h-9 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 rounded-full flex items-center justify-center transition" title="Guardar offline">
                    <i class="fa-solid fa-cloud-arrow-down text-xs"></i>
                </button>
                <button onclick="playSongByIndex(${index})" class="w-9 h-9 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-zinc-950 rounded-full flex items-center justify-center transition" title="Reproducir">
                    <i class="fa-solid fa-play text-xs ml-0.5"></i>
                </button>
                <button onclick="deleteSong('${song.id}', '${song.title}')" class="w-9 h-9 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded-full flex items-center justify-center transition" title="Eliminar canción">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </div>
        `;
        songsListContainer.appendChild(songDiv);
    });
}

// Botón Reproducir Todo
function playAllLibrary() {
    if (currentSongsList.length === 0) {
        alert("No hay canciones en la biblioteca.");
        return;
    }
    currentIndex = 0;
    playSongByIndex(currentIndex);
}

// --- CONFIGURACIÓN DE AUDIO Y SEEKBAR INDEPENDIENTE ---
const audioEl = document.getElementById("main-audio-element");
const progressBar = document.getElementById("progress-bar");

function setupAudioListeners() {
    audioEl.addEventListener("timeupdate", () => {
        if (!isNaN(audioEl.duration)) {
            const progress = (audioEl.currentTime / audioEl.duration) * 100;
            progressBar.value = progress;
            document.getElementById("current-time").textContent = formatTime(audioEl.currentTime);
            document.getElementById("total-duration").textContent = formatTime(audioEl.duration);
        }
    });

    // Permitir arrastrar o hacer clic en la barra para adelantar/atrasar
    progressBar.addEventListener("input", (e) => {
        if (!isNaN(audioEl.duration)) {
            const time = (e.target.value / 100) * audioEl.duration;
            audioEl.currentTime = time;
        }
    });
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Reproducción con soporte de carátula o disco de acetato girando
function playSongByIndex(index, broadcast = true) {
    if (index < 0 || index >= currentSongsList.length) return;
    currentIndex = index;
    const song = currentSongsList[currentIndex];
    const audioUrl = pb.files.getUrl(song, song.audio_file);
    const coverUrl = song.cover ? pb.files.getUrl(song, song.cover) : null;

    document.getElementById("audio-player-bar").classList.remove("hidden");
    document.getElementById("player-title").textContent = song.title;
    document.getElementById("player-artist").textContent = song.artist;

    const coverImg = document.getElementById("player-cover-img");
    const vinylDisk = document.getElementById("player-vinyl-disk");

    if (coverUrl) {
        coverImg.src = coverUrl;
        coverImg.classList.remove("hidden");
        vinylDisk.classList.add("hidden");
    } else {
        coverImg.classList.add("hidden");
        vinylDisk.classList.remove("hidden");
    }

    audioEl.src = audioUrl;
    audioEl.play();
    document.getElementById("play-pause-btn").innerHTML = `<i class="fa-solid fa-pause text-sm"></i>`;

    if (broadcast && currentRoomId && !isRemoteAction) {
        updateJamState({ songIndex: currentIndex, isPlaying: true });
    }
}

function playSongUrl(url, title, artist, cover = null) {
    document.getElementById("audio-player-bar").classList.remove("hidden");
    document.getElementById("player-title").textContent = title;
    document.getElementById("player-artist").textContent = artist;

    const coverImg = document.getElementById("player-cover-img");
    const vinylDisk = document.getElementById("player-vinyl-disk");

    if (cover) {
        coverImg.src = cover;
        coverImg.classList.remove("hidden");
        vinylDisk.classList.add("hidden");
    } else {
        coverImg.classList.add("hidden");
        vinylDisk.classList.remove("hidden");
    }

    audioEl.src = url;
    audioEl.play();
    document.getElementById("play-pause-btn").innerHTML = `<i class="fa-solid fa-pause text-sm"></i>`;
}

function togglePlay(broadcast = true) {
    if (audioEl.paused) {
        audioEl.play();
        document.getElementById("play-pause-btn").innerHTML = `<i class="fa-solid fa-pause text-sm"></i>`;
        if (broadcast && currentRoomId && !isRemoteAction) {
            updateJamState({ isPlaying: true });
        }
    } else {
        audioEl.pause();
        document.getElementById("play-pause-btn").innerHTML = `<i class="fa-solid fa-play text-sm ml-0.5"></i>`;
        if (broadcast && currentRoomId && !isRemoteAction) {
            updateJamState({ isPlaying: false });
        }
    }
}

function nextSong() {
    if (currentSongsList.length === 0) return;
    if (isShuffleActive) {
        currentIndex = Math.floor(Math.random() * currentSongsList.length);
    } else {
        currentIndex = (currentIndex + 1) % currentSongsList.length;
    }
    playSongByIndex(currentIndex);
}

function prevSong() {
    if (currentSongsList.length === 0) return;
    currentIndex = (currentIndex - 1 + currentSongsList.length) % currentSongsList.length;
    playSongByIndex(currentIndex);
}

// --- SALA JAM CON WHATSAPP Y SINCRONIZACIÓN EN TIEMPO REAL ---

async function createJamRoom() {
    try {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const record = await pb.collection('jam_rooms').create({
            room_code: code,
            host: pb.authStore.model.id,
            song_index: 0,
            is_playing: false
        });
        currentRoomId = record.id;
        
        document.getElementById("jam-status").classList.remove("hidden");
        document.getElementById("jam-room-code-display").textContent = code;
        alert(`¡Sala Jam creada con éxito! Código: ${code}`);
        
        subscribeToJamRoom(currentRoomId);
    } catch (e) {
        console.error("Error al crear sala Jam:", e);
        alert("Asegúrate de tener creada la colección 'jam_rooms' en PocketBase o usa un código compartido.");
    }
}

async function joinJamRoom() {
    const code = document.getElementById("room-code-input").value.trim().toUpperCase();
    if (!code) return;

    try {
        const records = await pb.collection('jam_rooms').getList(1, 1, {
            filter: `room_code = "${code}"`
        });

        if (records.items.length === 0) {
            alert("No se encontró ninguna sala con ese código.");
            return;
        }

        const room = records.items[0];
        currentRoomId = room.id;

        document.getElementById("jam-status").classList.remove("hidden");
        document.getElementById("jam-room-code-display").textContent = code;
        alert(`¡Conectado a la sala Jam ${code} en vivo!`);

        subscribeToJamRoom(currentRoomId);
    } catch (e) {
        console.error("Error al unirse a la sala:", e);
        alert("Error al conectar con la sala.");
    }
}

function shareJamWhatsApp() {
    const code = document.getElementById("jam-room-code-display").textContent;
    const text = encodeURIComponent(`¡Hola! Conéctate conmigo en mi sala Jam de Salva Music. Código de sala: *${code}* 🎶`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

async function updateJamState(stateObj) {
    if (!currentRoomId) return;
    try {
        const data = {};
        if (stateObj.songIndex !== undefined) data.song_index = stateObj.songIndex;
        if (stateObj.isPlaying !== undefined) data.is_playing = stateObj.isPlaying;
        
        await pb.collection('jam_rooms').update(currentRoomId, data);
    } catch (e) {
        console.error("Error sincronizando estado Jam:", e);
    }
}

function subscribeToJamRoom(roomId) {
    pb.collection('jam_rooms').subscribe(roomId, function (e) {
        if (e.action === "update") {
            const roomData = e.record;
            isRemoteAction = true;

            if (roomData.song_index !== undefined && roomData.song_index !== currentIndex) {
                playSongByIndex(roomData.song_index, false);
            }

            if (roomData.is_playing !== undefined) {
                if (roomData.is_playing && audioEl.paused) {
                    audioEl.play();
                    document.getElementById("play-pause-btn").innerHTML = `<i class="fa-solid fa-pause text-sm"></i>`;
                } else if (!roomData.is_playing && !audioEl.paused) {
                    audioEl.pause();
                    document.getElementById("play-pause-btn").innerHTML = `<i class="fa-solid fa-play text-sm ml-0.5"></i>`;
                }
            }

            setTimeout(() => { isRemoteAction = false; }, 500);
        }
    });
}

// --- PLAYLISTS Y OTRAS FUNCIONES ---

function openCreatePlaylistModal() {
    const modal = document.getElementById("create-playlist-modal");
    if (!modal) return;
    document.getElementById("playlist-name-input").value = "";
    const container = document.getElementById("playlist-selectable-songs");
    
    if (!currentSongsList || currentSongsList.length === 0) {
        container.innerHTML = `<p class="text-zinc-500 text-center py-4 text-xs">No hay canciones en tu biblioteca.</p>`;
    } else {
        container.innerHTML = "";
        currentSongsList.forEach((song) => {
            container.innerHTML += `
                <label class="flex items-center justify-between bg-zinc-950 p-2.5 rounded-xl border border-zinc-800 cursor-pointer hover:border-emerald-500 transition">
                    <div class="truncate flex items-center gap-2">
                        <input type="checkbox" value="${song.id}" class="playlist-song-checkbox w-4 h-4 accent-emerald-500 rounded">
                        <div class="truncate">
                            <p class="text-xs font-semibold text-white truncate">${song.title}</p>
                            <p class="text-[10px] text-zinc-400 truncate">${song.artist}</p>
                        </div>
                    </div>
                </label>
            `;
        });
    }
    modal.classList.remove("hidden");
}

function closeCreatePlaylistModal() {
    document.getElementById("create-playlist-modal").classList.add("hidden");
}

function saveNewPlaylist() {
    const name = document.getElementById("playlist-name-input").value.trim();
    if (!name) { alert("Ingresa un nombre para la playlist."); return; }

    const checkboxes = document.querySelectorAll(".playlist-song-checkbox:checked");
    const selectedSongIds = Array.from(checkboxes).map(cb => cb.value);

    if (selectedSongIds.length === 0) { alert("Selecciona al menos una canción."); return; }

    let playlists = JSON.parse(localStorage.getItem('salva_playlists') || '[]');
    playlists.push({ id: 'pl_' + Date.now(), name: name, songIds: selectedSongIds });
    localStorage.setItem('salva_playlists', JSON.stringify(playlists));

    alert(`¡Playlist "${name}" creada!`);
    closeCreatePlaylistModal();
    loadCustomPlaylists();
}

function loadCustomPlaylists() {
    const container = document.getElementById("custom-playlists-container");
    if (!container) return;
    const playlists = JSON.parse(localStorage.getItem('salva_playlists') || '[]');

    if (playlists.length === 0) {
        container.innerHTML = `<p class="text-zinc-600 text-center py-2 text-xs">No hay playlists personalizadas.</p>`;
        return;
    }

    container.innerHTML = "";
    playlists.forEach(pl => {
        container.innerHTML += `
            <div class="bg-zinc-900 border border-zinc-800 hover:border-emerald-500 p-4 rounded-2xl flex items-center justify-between cursor-pointer transition" onclick="openPlaylistDetail('${pl.id}')">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center text-lg">
                        <i class="fa-solid fa-list-music"></i>
                    </div>
                    <div>
                        <h3 class="text-sm font-bold text-white">${pl.name}</h3>
                        <p class="text-xs text-zinc-400">${pl.songIds.length} canciones</p>
                    </div>
                </div>
                <button onclick="event.stopPropagation(); deletePlaylist('${pl.id}')" class="text-zinc-500 hover:text-red-400 p-2"><i class="fa-solid fa-trash text-xs"></i></button>
            </div>
        `;
    });
}

function openPlaylistDetail(playlistId) {
    const playlists = JSON.parse(localStorage.getItem('salva_playlists') || '[]');
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;

    document.getElementById("view-playlist-title").textContent = pl.name;
    const container = document.getElementById("view-playlist-songs");
    container.innerHTML = "";

    const songsInPl = currentSongsList.filter(s => pl.songIds.includes(s.id));
    songsInPl.forEach((song) => {
        const audioUrl = pb.files.getUrl(song, song.audio_file);
        const coverUrl = song.cover ? pb.files.getUrl(song, song.cover) : null;
        container.innerHTML += `
            <div class="flex items-center justify-between bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <div class="truncate">
                    <h4 class="text-sm font-semibold text-white truncate">${song.title}</h4>
                    <p class="text-xs text-zinc-400 truncate">${song.artist}</p>
                </div>
                <button onclick="playSongUrl('${audioUrl}', '${song.title}', '${song.artist}', '${coverUrl}')" class="w-9 h-9 bg-emerald-500 text-zinc-950 rounded-full flex items-center justify-center">
                    <i class="fa-solid fa-play text-xs ml-0.5"></i>
                </button>
            </div>
        `;
    });
    document.getElementById("view-playlist-modal").classList.remove("hidden");
}

function closeViewPlaylistModal() {
    document.getElementById("view-playlist-modal").classList.add("hidden");
}

function deletePlaylist(playlistId) {
    if (!confirm("¿Eliminar esta playlist?")) return;
    let playlists = JSON.parse(localStorag
