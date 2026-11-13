package com.soundroom.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
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

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;

@UnstableApi
public class PlaybackService extends MediaLibraryService {

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

    private static PlaybackService instance;
    private static PlaybackListener playbackListener;
    private static String pendingQueueJson;
    private static int pendingStartIndex;
    private static long pendingPositionMs;
    private static boolean pendingPlayWhenReady;
    private static boolean hasPendingQueue;

    private ExoPlayer player;
    private MediaLibrarySession session;
    private SharedPreferences preferences;
    private Handler handler;
    private Runnable ticker;

    private String lastMediaId = "";
    private String lastQueueItemId = "";
    private long lastKnownPositionMs;
    private long lastKnownDurationMs;
    private long lastTransitionHandledAt;

    public static PlaybackService getInstance() {
        return instance;
    }

    public static void setPlaybackListener(@Nullable PlaybackListener listener) {
        playbackListener = listener;
        if (instance != null) {
            instance.notifyState();
        }
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
        instance.applyQueue(items, startIndex, positionMs, playWhenReady);
    }

    public static void updateQueue(
        JSONArray items,
        @Nullable String currentMediaId,
        long positionMs,
        boolean playWhenReady
    ) {
        if (instance == null) {
            pendingQueueJson = items.toString();
            pendingStartIndex = 0;
            pendingPositionMs = positionMs;
            pendingPlayWhenReady = playWhenReady;
            hasPendingQueue = true;
            return;
        }
        instance.applyQueueUpdate(
            items,
            currentMediaId,
            positionMs,
            playWhenReady
        );
    }

    public static void play() {
        if (instance != null && instance.player != null) {
            instance.player.play();
        }
    }

    public static void pause() {
        if (instance != null && instance.player != null) {
            instance.player.pause();
        }
    }

    public static void seekTo(long positionMs) {
        if (instance != null && instance.player != null) {
            instance.player.seekTo(Math.max(0, positionMs));
        }
    }

    public static void next() {
        if (instance != null && instance.player != null) {
            instance.player.seekToNextMediaItem();
        }
    }

    public static void previous() {
        if (instance != null && instance.player != null) {
            instance.player.seekToPreviousMediaItem();
        }
    }

    public static void stop() {
        if (instance != null && instance.player != null) {
            instance.player.pause();
            instance.player.clearMediaItems();
        }
    }

    public static JSONObject getState() {
        if (instance == null || instance.player == null) {
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
        return instance.buildState();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        player = buildPlayer();
        session = new MediaLibrarySession.Builder(
            this,
            player,
            new LibraryCallback()
        )
            .setSessionActivity(buildSessionActivity())
            .build();
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
        instance = null;
        super.onDestroy();
    }

    private ExoPlayer buildPlayer() {
        OkHttpClient client = new OkHttpClient.Builder()
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
        player.setPlayWhenReady(playWhenReady);
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
        boolean playWhenReady
    ) {
        List<MediaItem> newItems = buildMediaItems(items);
        if (newItems.isEmpty()) {
            return;
        }
        int newIndex = indexOfMediaId(newItems, currentMediaId);
        if (newIndex == -1) {
            newIndex = player.getCurrentMediaItemIndex();
        }
        int existingCount = player.getMediaItemCount();
        boolean sameCurrent = player.getCurrentMediaItem() != null &&
            currentMediaId != null &&
            currentMediaId.equals(player.getCurrentMediaItem().mediaId);

        if (sameCurrent && existingCount > 0) {
            boolean prefix = existingCount <= newItems.size();
            if (prefix) {
                for (int i = 0; i < existingCount; i++) {
                    if (!player.getMediaItemAt(i).mediaId.equals(
                            newItems.get(i).mediaId
                        )) {
                        prefix = false;
                        break;
                    }
                }
            }
            if (prefix && newItems.size() > existingCount) {
                player.addMediaItems(
                    newItems.subList(existingCount, newItems.size())
                );
            } else if (prefix && newItems.size() < existingCount) {
                player.removeMediaItems(newItems.size(), existingCount);
            } else {
                long currentPosition = player.getCurrentPosition();
                player.setMediaItems(newItems, newIndex, currentPosition);
                player.setPlayWhenReady(player.getPlayWhenReady());
            }
        } else {
            player.setMediaItems(newItems, newIndex, Math.max(0, positionMs));
            player.setPlayWhenReady(playWhenReady);
        }
        String activeMediaId = player.getCurrentMediaItem() != null
            ? player.getCurrentMediaItem().mediaId
            : currentMediaId;
        saveQueue(
            items,
            activeMediaId,
            player.getCurrentPosition(),
            player.getPlayWhenReady()
        );
        notifyLibraryChanged(newItems.size());
        notifyState();
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
        if (session != null) {
            session.notifyChildrenChanged(ROOT_ID, itemCount, null);
        }
    }

    private void notifyState() {
        if (player == null) {
            return;
        }
        JSONObject state = buildState();
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
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            notifyState();
        }

        @Override
        public void onPlaybackStateChanged(int playbackState) {
            notifyState();
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
            for (int i = 0; i < player.getMediaItemCount(); i++) {
                MediaItem item = player.getMediaItemAt(i);
                if (item.mediaId.equals(mediaId)) {
                    return Futures.immediateFuture(
                        LibraryResult.ofItem(item, null)
                    );
                }
            }
            return Futures.immediateFuture(
                LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
            );
        }
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
