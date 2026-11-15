package com.soundroom.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.webkit.CookieManager;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.LibraryResult;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionError;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

@UnstableApi
public class PlaybackService extends MediaLibraryService {

    private static final String TAG = "SoundroomPlayback";
    private static final String DEFAULT_BASE_URL =
        "https://soundroom.nacoraco.com";
    private static final String SERVER_URL_KEY = "server_url";
    private static final MediaType JSON_TYPE = MediaType.get(
        "application/json; charset=utf-8"
    );

    public static final String ROOT_ID = "soundroom-root";

    public interface PlaybackListener {
        void onState(JSONObject state);

        void onItemChanged(JSONObject change);

        void onError(String message);
    }

    private static final String PREFS = "soundroom_native_playback";
    private static final String KEY_QUEUE = "queue_json";
    private static final String KEY_CURRENT_MEDIA_ID = "current_media_id";
    private static final String KEY_POSITION_MS = "position_ms";
    private static final String KEY_PLAY_WHEN_READY = "play_when_ready";

    private static final Handler MAIN_HANDLER = new Handler(
        Looper.getMainLooper()
    );

    private static volatile PlaybackService instance;
    private static volatile PlaybackListener playbackListener;
    private static String pendingQueueJson;
    private static int pendingStartIndex;
    private static long pendingPositionMs;
    private static boolean pendingPlayWhenReady;
    private static boolean hasPendingQueue;
    private static boolean pendingPlay;

    private ExoPlayer player;
    private MediaLibrarySession session;
    private SharedPreferences preferences;
    private OkHttpClient httpClient;
    private Handler handler;
    private Runnable ticker;
    private final ExecutorService queueExecutor =
        Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean queueRequestInFlight;
    private long lastServerSyncAt;
    private long lastRefillAt;
    private String lastLibrarySignature = "";
    private DisplayManager displayManager;
    private boolean wasProjected;
    private DisplayManager.DisplayListener displayListener;

    private volatile JSONObject lastState = new JSONObject();
    private String lastMediaId = "";
    private String lastQueueItemId = "";
    private long lastKnownPositionMs;
    private long lastKnownDurationMs;
    private long lastTransitionHandledAt;

    public static PlaybackService getInstance() {
        return instance;
    }

    private static void runOnMain(Runnable action) {
        MAIN_HANDLER.post(action);
    }

    private void playPrepared() {
        if (player.getPlaybackState() == Player.STATE_IDLE) {
            player.prepare();
        }
        player.play();
    }

    private void applyPlaybackIntent(boolean playWhenReady) {
        player.setPlayWhenReady(playWhenReady);
        if (
            playWhenReady &&
            player.getPlaybackState() == Player.STATE_IDLE
        ) {
            player.prepare();
        }
    }

    public static void setPlaybackListener(@Nullable PlaybackListener listener) {
        playbackListener = listener;
        runOnMain(() -> {
            if (instance != null) {
                instance.notifyState();
            }
        });
    }

    public static void setQueue(
        JSONArray items,
        int startIndex,
        long positionMs,
        boolean playWhenReady
    ) {
        if (instance == null) {
            pendingQueueJson = items.toString();
            pendingStartIndex = startIndex;
            pendingPositionMs = positionMs;
            pendingPlayWhenReady = playWhenReady;
            hasPendingQueue = true;
            return;
        }
        runOnMain(() -> {
            if (instance != null) {
                instance.applyQueue(
                    items,
                    startIndex,
                    positionMs,
                    playWhenReady
                );
            }
        });
    }

    public static void updateQueue(
        JSONArray items,
        @Nullable String currentMediaId,
        long positionMs,
        boolean playWhenReady,
        boolean forceCurrent
    ) {
        if (instance == null) {
            pendingQueueJson = items.toString();
            pendingStartIndex = 0;
            pendingPositionMs = positionMs;
            pendingPlayWhenReady = playWhenReady;
            hasPendingQueue = true;
            return;
        }
        runOnMain(() -> {
            if (instance != null) {
                instance.applyQueueUpdate(
                    items,
                    currentMediaId,
                    positionMs,
                    playWhenReady,
                    forceCurrent
                );
            }
        });
    }

    public static void play() {
        runOnMain(() -> {
            if (instance != null && instance.player != null) {
                instance.playPrepared();
            } else {
                pendingPlay = true;
            }
        });
    }

    public static void pause() {
        runOnMain(() -> {
            pendingPlay = false;
            if (instance != null && instance.player != null) {
                instance.player.pause();
            }
        });
    }

    public static void seekTo(long positionMs) {
        runOnMain(() -> {
            if (instance != null && instance.player != null) {
                instance.player.seekTo(Math.max(0, positionMs));
            }
        });
    }

    public static void next() {
        runOnMain(() -> {
            if (instance != null && instance.player != null) {
                instance.player.seekToNextMediaItem();
            }
        });
    }

    public static void previous() {
        runOnMain(() -> {
            if (instance != null && instance.player != null) {
                instance.player.seekToPreviousMediaItem();
            }
        });
    }

    public static void stop() {
        runOnMain(() -> {
            pendingPlay = false;
            if (instance != null && instance.player != null) {
                instance.player.pause();
                instance.player.clearMediaItems();
            }
        });
    }

    public static JSONObject getState() {
        if (instance == null) {
            return emptyState();
        }
        JSONObject cached = instance.lastState;
        if (cached == null || cached.length() == 0) {
            return emptyState();
        }
        try {
            return new JSONObject(cached.toString());
        } catch (JSONException ignored) {
            return emptyState();
        }
    }

    private static JSONObject emptyState() {
        JSONObject empty = new JSONObject();
        try {
            empty.put("isPlaying", false);
            empty.put("position", 0);
            empty.put("duration", 0);
            empty.put("currentIndex", -1);
            empty.put("mediaId", "");
            empty.put("queueItemId", "");
            empty.put("ended", false);
        } catch (JSONException ignored) {
        }
        return empty;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        httpClient = new OkHttpClient.Builder()
            .cookieJar(new WebViewCookieJar())
            .build();
        setMediaNotificationProvider(
            new DefaultMediaNotificationProvider.Builder(this)
                .setChannelId("soundroom_playback")
                .setChannelName(R.string.notification_channel_name)
                .build()
        );
        player = buildPlayer();
        session = new MediaLibrarySession.Builder(
            this,
            player,
            new LibraryCallback()
        )
            .setSessionActivity(buildSessionActivity())
            .setPeriodicPositionUpdateEnabled(false)
            .build();
        addSession(session);
        player.addListener(new PlayerEvents());
        restoreQueue();
        if (hasPendingQueue && pendingQueueJson != null) {
            applyQueueFromJson(
                pendingQueueJson,
                pendingStartIndex,
                pendingPositionMs,
                pendingPlayWhenReady
            );
            hasPendingQueue = false;
            pendingQueueJson = null;
        }
        if (pendingPlay) {
            pendingPlay = false;
            if (player.getMediaItemCount() > 0) {
                playPrepared();
            }
        }
        handler = new Handler(Looper.getMainLooper());
        ticker = new Runnable() {
            @Override
            public void run() {
                notifyState();
                if (handler != null) {
                    handler.postDelayed(this, 1000);
                }
            }
        };
        handler.post(ticker);
        registerProjectionListener();
        mainHandler.postDelayed(
            () -> refreshServerQueue(false),
            1200
        );
    }

    @Override
    public MediaLibrarySession onGetSession(
        MediaSession.ControllerInfo controllerInfo
    ) {
        return session;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (player != null && player.isPlaying()) {
            return;
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (handler != null && ticker != null) {
            handler.removeCallbacks(ticker);
        }
        if (player != null) {
            player.release();
            player = null;
        }
        if (session != null) {
            session.release();
            session = null;
        }
        if (displayManager != null && displayListener != null) {
            displayManager.unregisterDisplayListener(displayListener);
        }
        queueExecutor.shutdownNow();
        instance = null;
        super.onDestroy();
    }

    private void registerProjectionListener() {
        displayManager = (DisplayManager) getSystemService(DISPLAY_SERVICE);
        if (displayManager == null) {
            return;
        }
        wasProjected = hasProjectionDisplay();
        displayListener = new DisplayManager.DisplayListener() {
            @Override
            public void onDisplayAdded(int displayId) {
                if (hasProjectionDisplay()) {
                    wasProjected = true;
                }
            }

            @Override
            public void onDisplayChanged(int displayId) {
            }

            @Override
            public void onDisplayRemoved(int displayId) {
                boolean projectedNow = hasProjectionDisplay();
                if (wasProjected && !projectedNow) {
                    wasProjected = false;
                    if (player != null && player.isPlaying()) {
                        Log.i(TAG, "Car projection ended; pausing playback");
                        player.pause();
                        pushPlaybackStateToServer(true);
                    }
                }
            }
        };
        displayManager.registerDisplayListener(
            displayListener,
            mainHandler
        );
    }

    private boolean hasProjectionDisplay() {
        if (displayManager == null) {
            return false;
        }
        for (Display display : displayManager.getDisplays()) {
            if (display.getDisplayId() != Display.DEFAULT_DISPLAY) {
                return true;
            }
        }
        return false;
    }

    private ExoPlayer buildPlayer() {
        OkHttpClient client = httpClient != null
            ? httpClient
            : new OkHttpClient.Builder()
                .cookieJar(new WebViewCookieJar())
                .build();
        DataSource.Factory dataSourceFactory = new OkHttpDataSource.Factory(
            client
        ).setUserAgent("Soundroom-Android");
        DefaultMediaSourceFactory mediaSourceFactory =
            new DefaultMediaSourceFactory(dataSourceFactory);
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();
        return new ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();
    }

    private PendingIntent buildSessionActivity() {
        Intent intent = new Intent(this, MainActivity.class)
            .setFlags(
                Intent.FLAG_ACTIVITY_SINGLE_TOP |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            );
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void applyQueue(
        JSONArray items,
        int startIndex,
        long positionMs,
        boolean playWhenReady
    ) {
        List<MediaItem> mediaItems = buildMediaItems(items);
        if (mediaItems.isEmpty()) {
            player.clearMediaItems();
            saveQueue(items, null, 0, false);
            notifyLibraryChanged(0);
            notifyState();
            return;
        }
        int index = Math.max(0, Math.min(startIndex, mediaItems.size() - 1));
        player.setMediaItems(mediaItems, index, Math.max(0, positionMs));
        applyPlaybackIntent(playWhenReady);
        String currentMediaId = mediaItems.get(index).mediaId;
        saveQueue(items, currentMediaId, positionMs, playWhenReady);
        notifyLibraryChanged(mediaItems.size());
        notifyState();
    }

    private void applyQueueFromJson(
        String json,
        int startIndex,
        long positionMs,
        boolean playWhenReady
    ) {
        try {
            applyQueue(
                new JSONArray(json),
                startIndex,
                positionMs,
                playWhenReady
            );
        } catch (JSONException ignored) {
        }
    }

    private void applyQueueUpdate(
        JSONArray items,
        @Nullable String currentMediaId,
        long positionMs,
        boolean playWhenReady,
        boolean forceCurrent
    ) {
        List<MediaItem> newItems = buildMediaItems(items);
        if (newItems.isEmpty()) {
            return;
        }
        String activeMediaId = currentMediaId();
        int activeIndex = indexOfMediaId(newItems, activeMediaId);

        if (
            !activeMediaId.isEmpty() &&
            activeIndex >= 0 &&
            (!forceCurrent || activeMediaId.equals(currentMediaId))
        ) {
            mergeQueuePreservingCurrent(newItems);
            saveQueueFromPlayer();
            notifyLibraryChanged(player.getMediaItemCount());
            notifyState();
            return;
        }

        int newIndex = indexOfMediaId(newItems, currentMediaId);
        if (newIndex == -1) {
            newIndex = Math.max(
                0,
                Math.min(
                    player.getCurrentMediaItemIndex(),
                    newItems.size() - 1
                )
            );
        }
        player.setMediaItems(newItems, newIndex, Math.max(0, positionMs));
        if (forceCurrent || activeMediaId.isEmpty()) {
            applyPlaybackIntent(playWhenReady);
        } else {
            applyPlaybackIntent(player.getPlayWhenReady());
        }
        saveQueueFromPlayer();
        notifyLibraryChanged(newItems.size());
        notifyState();
    }

    private void mergeQueuePreservingCurrent(List<MediaItem> newItems) {
        String activeMediaId = currentMediaId();
        if (activeMediaId.isEmpty()) {
            return;
        }
        java.util.Set<String> desiredIds = new java.util.HashSet<>();
        for (MediaItem item : newItems) {
            desiredIds.add(item.mediaId);
        }

        for (int i = player.getMediaItemCount() - 1; i >= 0; i--) {
            if (i == player.getCurrentMediaItemIndex()) {
                continue;
            }
            if (!desiredIds.contains(player.getMediaItemAt(i).mediaId)) {
                player.removeMediaItem(i);
            }
        }

        for (MediaItem desired : newItems) {
            int existingIndex = indexOfMediaId(currentPlaylist(), desired.mediaId);
            if (existingIndex == -1) {
                player.addMediaItem(desired);
                continue;
            }
            if (existingIndex != player.getCurrentMediaItemIndex()) {
                MediaItem existing = player.getMediaItemAt(existingIndex);
                if (!sameMediaSource(existing, desired)) {
                    player.replaceMediaItem(existingIndex, desired);
                }
            }
        }
    }

    private boolean sameMediaSource(MediaItem first, MediaItem second) {
        Uri firstUri = first.localConfiguration != null
            ? first.localConfiguration.uri
            : null;
        Uri secondUri = second.localConfiguration != null
            ? second.localConfiguration.uri
            : null;
        return firstUri != null && firstUri.equals(secondUri);
    }

    private List<MediaItem> currentPlaylist() {
        List<MediaItem> playlist = new ArrayList<>();
        for (int i = 0; i < player.getMediaItemCount(); i++) {
            playlist.add(player.getMediaItemAt(i));
        }
        return playlist;
    }

    private void saveQueueFromPlayer() {
        JSONArray items = new JSONArray();
        for (int i = 0; i < player.getMediaItemCount(); i++) {
            MediaItem item = player.getMediaItemAt(i);
            JSONObject entry = new JSONObject();
            try {
                entry.put("mediaId", item.mediaId);
                entry.put("queueItemId", item.mediaId);
                entry.put(
                    "streamUrl",
                    item.localConfiguration != null &&
                        item.localConfiguration.uri != null
                        ? item.localConfiguration.uri.toString()
                        : ""
                );
                entry.put(
                    "title",
                    item.mediaMetadata.title != null
                        ? item.mediaMetadata.title.toString()
                        : "Soundroom"
                );
                entry.put(
                    "artist",
                    item.mediaMetadata.artist != null
                        ? item.mediaMetadata.artist.toString()
                        : ""
                );
                entry.put(
                    "album",
                    item.mediaMetadata.albumTitle != null
                        ? item.mediaMetadata.albumTitle.toString()
                        : ""
                );
                entry.put(
                    "durationMs",
                    item.mediaMetadata.durationMs != null
                        ? item.mediaMetadata.durationMs
                        : 0
                );
                items.put(entry);
            } catch (JSONException ignored) {
            }
        }
        saveQueue(
            items,
            currentMediaId(),
            player.getCurrentPosition(),
            player.getPlayWhenReady()
        );
    }

    private List<MediaItem> buildMediaItems(JSONArray items) {
        List<MediaItem> mediaItems = new ArrayList<>();
        if (items == null) {
            return mediaItems;
        }
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) {
                continue;
            }
            String mediaId = item.optString("mediaId", "");
            String streamUrl = item.optString("streamUrl", "");
            if (mediaId.isEmpty() || streamUrl.isEmpty()) {
                continue;
            }
            String title = item.optString("title", "Soundroom");
            String artist = item.optString("artist", "");
            String album = item.optString("album", "");
            long durationMs = item.optLong("durationMs", 0);
            MediaMetadata metadata = new MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist)
                .setAlbumTitle(album)
                .setArtworkUri(
                    Uri.parse(
                        "android.resource://" +
                            getPackageName() +
                            "/drawable/media_artwork"
                    )
                )
                .setIsBrowsable(false)
                .setIsPlayable(true)
                .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                .build();
            mediaItems.add(
                new MediaItem.Builder()
                    .setMediaId(mediaId)
                    .setUri(Uri.parse(streamUrl))
                    .setMediaMetadata(metadata)
                    .build()
            );
        }
        return mediaItems;
    }

    private int indexOfMediaId(List<MediaItem> items, @Nullable String mediaId) {
        if (mediaId == null) {
            return -1;
        }
        for (int i = 0; i < items.size(); i++) {
            if (mediaId.equals(items.get(i).mediaId)) {
                return i;
            }
        }
        return -1;
    }

    private void saveQueue(
        JSONArray items,
        @Nullable String currentMediaId,
        long positionMs,
        boolean playWhenReady
    ) {
        if (preferences == null) {
            return;
        }
        preferences
            .edit()
            .putString(KEY_QUEUE, items != null ? items.toString() : "[]")
            .putString(
                KEY_CURRENT_MEDIA_ID,
                currentMediaId != null ? currentMediaId : ""
            )
            .putLong(KEY_POSITION_MS, Math.max(0, positionMs))
            .putBoolean(KEY_PLAY_WHEN_READY, playWhenReady)
            .apply();
    }

    private void restoreQueue() {
        if (preferences == null) {
            return;
        }
        String json = preferences.getString(KEY_QUEUE, "[]");
        String currentMediaId = preferences.getString(
            KEY_CURRENT_MEDIA_ID,
            ""
        );
        long positionMs = preferences.getLong(KEY_POSITION_MS, 0);
        try {
            JSONArray items = new JSONArray(json);
            List<MediaItem> mediaItems = buildMediaItems(items);
            if (mediaItems.isEmpty()) {
                return;
            }
            int index = indexOfMediaId(mediaItems, currentMediaId);
            if (index == -1) {
                index = 0;
            }
            player.setMediaItems(mediaItems, index, Math.max(0, positionMs));
            player.setPlayWhenReady(false);
            notifyLibraryChanged(mediaItems.size());
        } catch (JSONException ignored) {
        }
    }

    private void notifyLibraryChanged(int itemCount) {
        if (session == null) {
            return;
        }
        StringBuilder signature = new StringBuilder();
        for (int i = 0; i < player.getMediaItemCount(); i++) {
            signature.append(player.getMediaItemAt(i).mediaId).append('|');
        }
        signature.append(itemCount);
        String value = signature.toString();
        if (value.equals(lastLibrarySignature)) {
            return;
        }
        lastLibrarySignature = value;
        session.notifyChildrenChanged(ROOT_ID, itemCount, null);
    }

    private void notifyState() {
        if (player == null) {
            return;
        }
        JSONObject state = buildState();
        lastState = state;
        long position = player.getCurrentPosition();
        long duration = player.getDuration();
        if (duration == C.TIME_UNSET || duration < 0) {
            duration = 0;
        }
        lastKnownPositionMs = position;
        lastKnownDurationMs = duration;
        if (preferences != null) {
            preferences
                .edit()
                .putLong(KEY_POSITION_MS, Math.max(0, position))
                .putBoolean(KEY_PLAY_WHEN_READY, player.getPlayWhenReady())
                .apply();
        }
        if (playbackListener != null) {
            try {
                playbackListener.onState(state);
            } catch (RuntimeException ignored) {
            }
        }
    }

    private JSONObject buildState() {
        JSONObject state = new JSONObject();
        try {
            MediaItem current = player.getCurrentMediaItem();
            long duration = player.getDuration();
            if (duration == C.TIME_UNSET || duration < 0) {
                duration = 0;
            }
            state.put("isPlaying", player.isPlaying());
            state.put(
                "position",
                Math.max(0, player.getCurrentPosition()) / 1000.0
            );
            state.put("duration", duration / 1000.0);
            state.put(
                "currentIndex",
                player.getCurrentMediaItemIndex()
            );
            state.put("mediaId", current != null ? current.mediaId : "");
            state.put(
                "queueItemId",
                current != null ? current.mediaId : ""
            );
            state.put(
                "ended",
                player.getPlaybackState() == Player.STATE_ENDED
            );
        } catch (JSONException ignored) {
        }
        return state;
    }

    private final class PlayerEvents implements Player.Listener {

        @Override
        public void onMediaItemTransition(
            @Nullable MediaItem mediaItem,
            int reason
        ) {
            long now = System.currentTimeMillis();
            if (now - lastTransitionHandledAt < 200) {
                return;
            }
            lastTransitionHandledAt = now;
            JSONObject change = new JSONObject();
            try {
                MediaItem current = player.getCurrentMediaItem();
                change.put(
                    "mediaId",
                    current != null ? current.mediaId : ""
                );
                change.put(
                    "queueItemId",
                    current != null ? current.mediaId : ""
                );
                change.put(
                    "index",
                    player.getCurrentMediaItemIndex()
                );
                change.put("previousMediaId", lastMediaId);
                change.put("previousQueueItemId", lastQueueItemId);
                change.put("previousPosition", lastKnownPositionMs / 1000.0);
                change.put("previousDuration", lastKnownDurationMs / 1000.0);
                change.put("reason", reason);
            } catch (JSONException ignored) {
            }
            lastMediaId = currentMediaId();
            lastQueueItemId = currentMediaId();
            if (playbackListener != null) {
                try {
                    playbackListener.onItemChanged(change);
                } catch (RuntimeException ignored) {
                }
            }
            notifyState();
            pushPlaybackStateToServer(true);
            maybeRefillFromServer();
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            notifyState();
            pushPlaybackStateToServer(true);
        }

        @Override
        public void onPlaybackStateChanged(int playbackState) {
            notifyState();
            if (playbackState == Player.STATE_ENDED) {
                pushPlaybackStateToServer();
            }
        }

        @Override
        public void onPlayerError(androidx.media3.common.PlaybackException error) {
            if (playbackListener != null) {
                try {
                    playbackListener.onError(
                        error != null ? error.getMessage() : "Playback error"
                    );
                } catch (RuntimeException ignored) {
                }
            }
        }
    }

    private String currentMediaId() {
        MediaItem current = player != null ? player.getCurrentMediaItem() : null;
        return current != null ? current.mediaId : "";
    }

    private final class LibraryCallback
        implements MediaLibraryService.MediaLibrarySession.Callback {

        @Override
        public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(
            MediaLibrarySession session,
            MediaSession.ControllerInfo browser,
            @Nullable MediaLibraryService.LibraryParams params
        ) {
            MediaItem root = new MediaItem.Builder()
                .setMediaId(ROOT_ID)
                .setMediaMetadata(
                    new MediaMetadata.Builder()
                        .setTitle("Soundroom")
                        .setIsBrowsable(true)
                        .setIsPlayable(false)
                        .build()
                )
                .build();
            return Futures.immediateFuture(LibraryResult.ofItem(root, params));
        }

        @Override
        public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(
            MediaLibrarySession session,
            MediaSession.ControllerInfo browser,
            String parentId,
            int page,
            int pageSize,
            @Nullable MediaLibraryService.LibraryParams params
        ) {
            List<MediaItem> items = new ArrayList<>();
            if (ROOT_ID.equals(parentId)) {
                for (int i = 0; i < player.getMediaItemCount(); i++) {
                    items.add(player.getMediaItemAt(i));
                }
            }
            return Futures.immediateFuture(
                LibraryResult.ofItemList(
                    ImmutableList.copyOf(items),
                    params
                )
            );
        }

        @Override
        public ListenableFuture<LibraryResult<MediaItem>> onGetItem(
            MediaLibrarySession session,
            MediaSession.ControllerInfo browser,
            String mediaId
        ) {
            MediaItem item = findMediaItem(mediaId);
            if (item != null) {
                return Futures.immediateFuture(
                    LibraryResult.ofItem(item, null)
                );
            }
            return Futures.immediateFuture(
                LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
            );
        }

        @Override
        public ListenableFuture<List<MediaItem>> onAddMediaItems(
            MediaSession mediaSession,
            MediaSession.ControllerInfo controller,
            List<MediaItem> mediaItems
        ) {
            return Futures.immediateFuture(resolveMediaItems(mediaItems));
        }

        @Override
        public ListenableFuture<MediaSession.MediaItemsWithStartPosition>
            onSetMediaItems(
                MediaSession mediaSession,
                MediaSession.ControllerInfo controller,
                List<MediaItem> mediaItems,
                int startIndex,
                long startPositionMs
            ) {
            List<MediaItem> resolved = resolveMediaItems(mediaItems);
            if (resolved.isEmpty()) {
                return Futures.immediateFuture(
                    new MediaSession.MediaItemsWithStartPosition(
                        resolved,
                        0,
                        Math.max(0, startPositionMs)
                    )
                );
            }

            List<MediaItem> playlist = currentPlaylist();
            if (playlist.isEmpty()) {
                playlist = resolved;
            } else if (resolved.size() == 1) {
                String selectedId = resolved.get(0).mediaId;
                int selectedIndex = indexOfMediaId(playlist, selectedId);
                if (selectedIndex == -1) {
                    playlist.add(resolved.get(0));
                    selectedIndex = playlist.size() - 1;
                }
                return Futures.immediateFuture(
                    new MediaSession.MediaItemsWithStartPosition(
                        playlist,
                        selectedIndex,
                        Math.max(0, startPositionMs)
                    )
                );
            } else {
                playlist = resolved;
            }

            int index = Math.max(
                0,
                Math.min(startIndex, playlist.size() - 1)
            );
            return Futures.immediateFuture(
                new MediaSession.MediaItemsWithStartPosition(
                    playlist,
                    index,
                    Math.max(0, startPositionMs)
                )
            );
        }

        @Override
        public ListenableFuture<MediaSession.MediaItemsWithStartPosition>
            onPlaybackResumption(
                MediaSession mediaSession,
                MediaSession.ControllerInfo controller
            ) {
            List<MediaItem> playlist = currentPlaylist();
            if (playlist.isEmpty()) {
                return Futures.immediateFuture(null);
            }
            int index = Math.max(
                0,
                player.getCurrentMediaItemIndex()
            );
            long positionMs = preferences != null
                ? preferences.getLong(KEY_POSITION_MS, 0)
                : 0;
            return Futures.immediateFuture(
                new MediaSession.MediaItemsWithStartPosition(
                    playlist,
                    index,
                    Math.max(0, positionMs)
                )
            );
        }

        private List<MediaItem> resolveMediaItems(
            List<MediaItem> requested
        ) {
            List<MediaItem> resolved = new ArrayList<>();
            for (MediaItem requestedItem : requested) {
                MediaItem known = findMediaItem(requestedItem.mediaId);
                if (known != null) {
                    resolved.add(known);
                } else if (requestedItem.localConfiguration != null) {
                    resolved.add(requestedItem);
                }
            }
            return resolved;
        }

        private MediaItem findMediaItem(String mediaId) {
            if (mediaId == null || mediaId.isEmpty()) {
                return null;
            }
            for (int i = 0; i < player.getMediaItemCount(); i++) {
                MediaItem item = player.getMediaItemAt(i);
                if (item.mediaId.equals(mediaId)) {
                    return item;
                }
            }
            return null;
        }

        private List<MediaItem> currentPlaylist() {
            List<MediaItem> playlist = new ArrayList<>();
            for (int i = 0; i < player.getMediaItemCount(); i++) {
                playlist.add(player.getMediaItemAt(i));
            }
            return playlist;
        }
    }

    private String baseUrl() {
        if (preferences == null) {
            return DEFAULT_BASE_URL;
        }
        String configured = preferences.getString(
            SERVER_URL_KEY,
            DEFAULT_BASE_URL
        );
        return configured == null || configured.isEmpty()
            ? DEFAULT_BASE_URL
            : configured.replaceAll("/+$", "");
    }

    private JSONObject getJson(String path) throws IOException, JSONException {
        if (httpClient == null) {
            return null;
        }
        Request request = new Request.Builder()
            .url(baseUrl() + path)
            .get()
            .build();
        try (Response response = httpClient.newCall(request).execute()) {
            Log.i(TAG, "GET " + path + " -> " + response.code());
            if (!response.isSuccessful() || response.body() == null) {
                return null;
            }
            return new JSONObject(response.body().string());
        }
    }

    private JSONObject postJson(
        String path,
        String csrfToken,
        String payload
    ) throws IOException, JSONException {
        if (httpClient == null) {
            return null;
        }
        Request request = new Request.Builder()
            .url(baseUrl() + path)
            .header("X-CSRF-Token", csrfToken)
            .post(RequestBody.create(payload, JSON_TYPE))
            .build();
        try (Response response = httpClient.newCall(request).execute()) {
            Log.i(TAG, "POST " + path + " -> " + response.code());
            if (!response.isSuccessful() || response.body() == null) {
                return null;
            }
            return new JSONObject(response.body().string());
        }
    }

    private String fetchCsrfToken() throws IOException, JSONException {
        JSONObject me = getJson("/api/auth/me");
        String token = me != null ? me.optString("csrf_token", "") : "";
        Log.i(TAG, "CSRF token length=" + token.length());
        return token;
    }

    private void refreshServerQueue(boolean refill) {
        if (player == null || queueRequestInFlight) {
            return;
        }
        queueRequestInFlight = true;
        queueExecutor.execute(() -> {
            try {
                String csrfToken = fetchCsrfToken();
                if (csrfToken.isEmpty()) {
                    return;
                }
                JSONObject state = null;
                if (refill) {
                    state = postJson("/api/queue/refill", csrfToken, "{}");
                }
                if (state == null) {
                    state = getJson("/api/queue");
                }
                if (state == null) {
                    return;
                }
                List<MediaItem> items = parseServerQueueItems(
                    state.optJSONArray("items")
                );
                Log.i(
                    TAG,
                    "Server queue items=" +
                        items.size() +
                        " refill=" +
                        refill
                );
                if (items.isEmpty()) {
                    return;
                }
                String currentId = state.optString("current_item_id", "");
                long positionMs = Math.max(
                    0,
                    state.optInt("position_seconds", 0) * 1000L
                );
                mainHandler.post(
                    () -> applyServerQueue(items, currentId, positionMs)
                );
            } catch (Exception error) {
                Log.w(TAG, "Could not refresh queue from server", error);
            } finally {
                queueRequestInFlight = false;
            }
        });
    }

    private void applyServerQueue(
        List<MediaItem> items,
        String serverCurrentId,
        long serverPositionMs
    ) {
        if (player == null || items.isEmpty()) {
            return;
        }
        String nativeCurrentId = currentMediaId();
        boolean nativeCurrentExists =
            indexOfMediaId(items, nativeCurrentId) >= 0;
        if (!player.isPlaying() && !nativeCurrentExists) {
            int index = indexOfMediaId(items, serverCurrentId);
            if (index == -1) {
                index = 0;
            }
            player.setMediaItems(
                items,
                index,
                Math.max(0, serverPositionMs)
            );
            player.setPlayWhenReady(false);
            saveQueueFromPlayer();
            notifyLibraryChanged(items.size());
            notifyState();
            return;
        }

        mergeQueuePreservingCurrent(items);
        saveQueueFromPlayer();
        notifyLibraryChanged(player.getMediaItemCount());
        notifyState();
    }

    private List<MediaItem> parseServerQueueItems(JSONArray items) {
        List<MediaItem> mediaItems = new ArrayList<>();
        if (items == null) {
            return mediaItems;
        }
        String base = baseUrl();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || !"ready".equals(item.optString("status"))) {
                continue;
            }
            JSONObject track = item.optJSONObject("track");
            if (track == null || !track.optBoolean("is_available", true)) {
                continue;
            }
            String queueItemId = item.optString("id", "");
            String trackId = track.optString("id", "");
            if (queueItemId.isEmpty() || trackId.isEmpty()) {
                continue;
            }
            String version = track.optString("stream_version", "");
            String streamUrl = base + "/api/tracks/" + trackId + "/stream";
            if (!version.isEmpty()) {
                streamUrl += "?v=" + Uri.encode(version);
            }
            String title = track.optString("title", "Soundroom");
            String artist = track.optString("artist_name", "");
            String album = track.optString("album_title", "");
            long durationMs = Math.max(
                0,
                track.optLong("duration_seconds", 0) * 1000L
            );
            MediaMetadata metadata = new MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist)
                .setAlbumTitle(album)
                .setArtworkUri(
                    Uri.parse(
                        "android.resource://" +
                            getPackageName() +
                            "/drawable/media_artwork"
                    )
                )
                .setIsBrowsable(false)
                .setIsPlayable(true)
                .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                .build();
            mediaItems.add(
                new MediaItem.Builder()
                    .setMediaId(queueItemId)
                    .setUri(Uri.parse(streamUrl))
                    .setMediaMetadata(metadata)
                    .build()
            );
        }
        return mediaItems;
    }

    private void pushPlaybackStateToServer() {
        pushPlaybackStateToServer(false);
    }

    private void pushPlaybackStateToServer(boolean force) {
        if (player == null) {
            return;
        }
        long now = System.currentTimeMillis();
        if (!force && now - lastServerSyncAt < 2000) {
            return;
        }
        lastServerSyncAt = now;
        String currentId = currentMediaId();
        if (currentId.isEmpty()) {
            return;
        }
        boolean isPlaying = player.getPlayWhenReady();
        long positionSeconds = Math.max(0, player.getCurrentPosition()) / 1000;
        queueExecutor.execute(() -> {
            try {
                String csrfToken = fetchCsrfToken();
                if (csrfToken.isEmpty()) {
                    return;
                }
                JSONObject payload = new JSONObject();
                payload.put("current_item_id", currentId);
                payload.put("is_playing", isPlaying);
                payload.put("position_seconds", positionSeconds);
                postJson("/api/queue/state", csrfToken, payload.toString());
            } catch (Exception error) {
                Log.w(TAG, "Could not push playback state", error);
            }
        });
    }

    private void maybeRefillFromServer() {
        if (player == null) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastRefillAt < 10000) {
            return;
        }
        int remaining =
            player.getMediaItemCount() -
            player.getCurrentMediaItemIndex() -
            1;
        if (remaining > 2) {
            return;
        }
        lastRefillAt = now;
        refreshServerQueue(true);
    }

    private static final class WebViewCookieJar implements CookieJar {

        @Override
        public void saveFromResponse(HttpUrl url, List<Cookie> cookies) {
            // The WebView login cookie is the source of truth.
        }

        @Override
        public List<Cookie> loadForRequest(HttpUrl url) {
            String raw = CookieManager
                .getInstance()
                .getCookie(url.toString());
            if (raw == null || raw.isEmpty()) {
                return Collections.emptyList();
            }
            List<Cookie> cookies = new ArrayList<>();
            for (String part : raw.split(";")) {
                Cookie cookie = Cookie.parse(url, part.trim());
                if (cookie != null) {
                    cookies.add(cookie);
                }
            }
            return cookies;
        }
    }
}
