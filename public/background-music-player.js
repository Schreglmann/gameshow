/**
 * Background Music Player with seamless looping and crossfading
 */
class BackgroundMusicPlayer {
    constructor() {
        this.playlist = [];
        this.currentTrackIndex = 0;
        this.audioElements = [new Audio(), new Audio()]; // Two audio elements for crossfading
        this.currentAudioIndex = 0;
        this.isPlaying = false;
        this.volume = 0.20; // Low volume for background music (20%)
        this.crossfadeDuration = 2000; // 2 seconds crossfade
        this.playlistLoaded = false;
        
        // Setup audio elements
        this.audioElements.forEach(audio => {
            audio.volume = this.volume; // Set initial volume
            audio.loop = false; // We handle looping manually for seamless transitions
        });
        
        // Load playlist
        this.loadPlaylist();
    }
    
    async loadPlaylist() {
        try {
            const response = await fetch('/api/background-music');
            const files = await response.json();
            
            if (files && files.length > 0) {
                this.playlist = files.map(file => `/background-music/${file}`);
                this.shufflePlaylist();
                this.playlistLoaded = true;
                console.log(`Loaded ${this.playlist.length} background music tracks`);
            }
        } catch (error) {
            console.error('Failed to load background music playlist:', error);
        }
    }
    
    shufflePlaylist() {
        // Fisher-Yates shuffle algorithm
        for (let i = this.playlist.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
        }
    }
    
    start() {
        if (this.playlist.length === 0) {
            console.warn('No background music available');
            return;
        }
        
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        this.playTrack(0);
    }
    
    playTrack(index) {
        if (!this.isPlaying || this.playlist.length === 0) return;
        
        this.currentTrackIndex = index % this.playlist.length;
        const nextAudioIndex = (this.currentAudioIndex + 1) % 2;
        const nextAudio = this.audioElements[nextAudioIndex];
        const currentAudio = this.audioElements[this.currentAudioIndex];
        
        // Load next track
        nextAudio.src = this.playlist[this.currentTrackIndex];
        nextAudio.load();
        
        // Wait for the track to be ready
        nextAudio.addEventListener('canplaythrough', () => {
            // Start playing
            const playPromise = nextAudio.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        console.log('Playing:', this.playlist[this.currentTrackIndex]);
                        console.log('Audio volume:', nextAudio.volume);
                        console.log('Audio muted:', nextAudio.muted);
                        
                        // If this is the first track (no previous audio), just set volume directly
                        if (!currentAudio.src) {
                            nextAudio.volume = this.volume;
                            console.log('Set initial volume to:', this.volume);
                        } else {
                            // Fade in new track and fade out old track
                            this.crossfade(currentAudio, nextAudio);
                        }
                        
                        // Switch to the new audio element
                        this.currentAudioIndex = nextAudioIndex;
                        
                        // Setup next track when this one ends
                        let nextTrackScheduled = false;
                        const scheduleNextTrack = () => {
                            const timeLeft = nextAudio.duration - nextAudio.currentTime;
                            // Start crossfade 3 seconds before the end
                            if (!nextTrackScheduled && timeLeft <= 3) {
                                nextTrackScheduled = true;
                                this.playTrack(this.currentTrackIndex + 1);
                            }
                        };
                        
                        nextAudio.addEventListener('timeupdate', scheduleNextTrack);
                        nextAudio.addEventListener('ended', () => {
                            // Fallback if timeupdate didn't trigger
                            if (!nextTrackScheduled) {
                                this.playTrack(this.currentTrackIndex + 1);
                            }
                        }, { once: true });
                    })
                    .catch(e => {
                        console.error('Background music play error:', e);
                        // If autoplay fails, mark as not playing so user can manually start
                        this.isPlaying = false;
                        const playPauseBtn = document.getElementById('musicPlayPause');
                        if (playPauseBtn) {
                            playPauseBtn.textContent = '▶';
                        }
                    });
            }
        }, { once: true });
    }
    
    crossfade(fadeOutAudio, fadeInAudio) {
        const steps = 20;
        const stepDuration = this.crossfadeDuration / steps;
        let step = 0;
        
        const interval = setInterval(() => {
            step++;
            const progress = step / steps;
            
            // Fade out old track
            if (fadeOutAudio.src) {
                fadeOutAudio.volume = this.volume * (1 - progress);
            }
            
            // Fade in new track
            fadeInAudio.volume = this.volume * progress;
            
            if (step >= steps) {
                clearInterval(interval);
                // Stop and reset the old track
                if (fadeOutAudio.src) {
                    fadeOutAudio.pause();
                    fadeOutAudio.currentTime = 0;
                    fadeOutAudio.src = '';
                }
            }
        }, stepDuration);
    }
    
    stop() {
        this.isPlaying = false;
        this.audioElements.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 0;
        });
    }
    
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        // Set volume on both audio elements for seamless crossfading
        this.audioElements.forEach(audio => {
            if (audio.src) {
                audio.volume = this.volume;
            }
        });
    }
    
    pause() {
        this.audioElements.forEach(audio => audio.pause());
        this.isPlaying = false;
    }
    
    resume() {
        if (!this.isPlaying && this.audioElements[this.currentAudioIndex].src) {
            // Resume existing track only
            this.isPlaying = true;
            this.audioElements[this.currentAudioIndex].play();
        }
    }
    
    skipToNext() {
        // Stop current track and play next one
        this.audioElements.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
        this.currentTrackIndex = (this.currentTrackIndex + 1) % this.playlist.length;
        this.playTrack(this.currentTrackIndex);
    }
    
    fadeOut(duration = 2000) {
        const currentAudio = this.audioElements[this.currentAudioIndex];
        const startVolume = currentAudio.volume;
        const steps = 20;
        const stepDuration = duration / steps;
        let step = 0;
        
        const interval = setInterval(() => {
            step++;
            const progress = step / steps;
            currentAudio.volume = startVolume * (1 - progress);
            
            if (step >= steps) {
                clearInterval(interval);
                this.pause();
                currentAudio.volume = this.volume; // Reset to original volume
            }
        }, stepDuration);
    }
    
    fadeIn(duration = 2000) {
        const currentAudio = this.audioElements[this.currentAudioIndex];
        currentAudio.volume = 0;
        
        // Resume if not playing
        if (!this.isPlaying) {
            this.resume();
        }
        
        const steps = 20;
        const stepDuration = duration / steps;
        let step = 0;
        
        const interval = setInterval(() => {
            step++;
            const progress = step / steps;
            currentAudio.volume = this.volume * progress;
            
            if (step >= steps) {
                clearInterval(interval);
                currentAudio.volume = this.volume;
            }
        }, stepDuration);
    }
}

// Create global instance
window.backgroundMusicPlayer = new BackgroundMusicPlayer();
