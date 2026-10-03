function playbackState(event) {
  const api = window.wallpaperMediaIntegration;
  const playingValues = [api?.PLAYBACK_PLAYING, api?.playback?.PLAYING, 1].filter((value) => value !== undefined);
  const pausedValues = [api?.PLAYBACK_PAUSED, api?.playback?.PAUSED, 2].filter((value) => value !== undefined);
  if (playingValues.includes(event.state)) return "playing";
  if (pausedValues.includes(event.state)) return "paused";
  return "stopped";
}

export function installMediaIntegration(store) {
  if (typeof window.wallpaperRegisterMediaPropertiesListener !== "function") return false;

  window.wallpaperRegisterMediaStatusListener?.((event) => {
    store.update((state) => ({ ...state, media: { ...state.media, enabled: Boolean(event.enabled) } }));
  });

  window.wallpaperRegisterMediaPropertiesListener((event) => {
    store.update((state) => ({
      ...state,
      media: {
        ...state.media,
        title: event.title || "Untitled",
        artist: event.artist || event.albumArtist || "Unknown artist",
        album: event.albumTitle || "",
      },
    }));
  });

  window.wallpaperRegisterMediaThumbnailListener?.((event) => {
    store.update((state) => ({
      ...state,
      media: {
        ...state.media,
        thumbnail: event.thumbnail || "",
        primaryColor: event.primaryColor || event.secondaryColor || "",
      },
    }));
  });

  window.wallpaperRegisterMediaPlaybackListener?.((event) => {
    store.update((state) => ({ ...state, media: { ...state.media, state: playbackState(event) } }));
  });

  window.wallpaperRegisterMediaTimelineListener?.((event) => {
    store.update((state) => ({
      ...state,
      media: { ...state.media, position: event.position ?? null, duration: event.duration ?? null },
    }));
  });
  return true;
}

export function startDemoMedia(store) {
  store.update((state) => ({
    ...state,
    media: {
      ...state.media,
      state: "playing",
      title: "SOFT SIGNALS",
      artist: "LOCAL SESSION",
      album: "QUIET SYSTEM",
      primaryColor: "#8b77ff",
      position: 134,
      duration: 222,
    },
  }));

  const timer = window.setInterval(() => {
    store.update((state) => ({
      ...state,
      media: {
        ...state.media,
        position: Math.min(state.media.duration, (state.media.position ?? 0) + 1),
      },
    }));
  }, 1000);
  return () => window.clearInterval(timer);
}
