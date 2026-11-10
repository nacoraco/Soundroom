package com.soundroom.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class PlaybackService extends Service {

    public interface MediaActionListener {
        void onMediaAction(String action);
    }

    private static final String CHANNEL_ID = "soundroom_playback";
    private static final int NOTIFICATION_ID = 1;
    private static final String ACTION_PREVIOUS = "com.soundroom.app.ACTION_PREVIOUS";
    private static final String ACTION_TOGGLE = "com.soundroom.app.ACTION_TOGGLE";
    private static final String ACTION_NEXT = "com.soundroom.app.ACTION_NEXT";

    private static PlaybackService instance;
    private static MediaActionListener actionListener;

    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private Bitmap artwork;
    private String currentTitle = "Soundroom";
    private String currentArtist = "";
    private String currentAlbum = "";
    private long currentDurationMs = 0;
    private long currentPositionMs = 0;
    private boolean isPlaying = false;

    public static void setActionListener(MediaActionListener listener) {
        actionListener = listener;
    }

    public static void updateMediaSession(
        String title,
        String artist,
        String album,
        long durationMs,
        boolean playing,
        long positionMs
    ) {
        if (instance != null) {
            instance.applyMediaSession(title, artist, album, durationMs, playing, positionMs);
        }
    }

    public static void clearMediaSession() {
        if (instance != null) {
            instance.applyMediaSession("Soundroom", "", "", 0, false, 0);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        artwork = BitmapFactory.decodeResource(getResources(), R.drawable.media_artwork);

        mediaSession = new MediaSession(this, "Soundroom");
        mediaSession.setCallback(
            new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    dispatchAction("play");
                }

                @Override
                public void onPause() {
                    dispatchAction("pause");
                }

                @Override
                public void onSkipToNext() {
                    dispatchAction("next");
                }

                @Override
                public void onSkipToPrevious() {
                    dispatchAction("previous");
                }

                @Override
                public void onSeekTo(long positionMs) {
                    dispatchAction("seek:" + positionMs);
                }

                @Override
                public void onStop() {
                    dispatchAction("pause");
                }
            }
        );
        mediaSession.setActive(true);
        applyMediaSession(currentTitle, currentArtist, currentAlbum, 0, false, 0);

        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "Soundroom::Playback"
            );
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_PREVIOUS.equals(action)) {
                dispatchAction("previous");
            } else if (ACTION_NEXT.equals(action)) {
                dispatchAction("next");
            } else if (ACTION_TOGGLE.equals(action)) {
                dispatchAction(isPlaying ? "pause" : "play");
            }
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void applyMediaSession(
        String title,
        String artist,
        String album,
        long durationMs,
        boolean playing,
        long positionMs
    ) {
        currentTitle = title == null || title.isEmpty() ? "Soundroom" : title;
        currentArtist = artist == null ? "" : artist;
        currentAlbum = album == null ? "" : album;
        currentDurationMs = Math.max(durationMs, 0);
        currentPositionMs = Math.max(positionMs, 0);
        isPlaying = playing;

        MediaMetadata.Builder metadataBuilder = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, currentAlbum)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, currentDurationMs);
        if (artwork != null) {
            metadataBuilder
                .putBitmap(MediaMetadata.METADATA_KEY_ART, artwork)
                .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork)
                .putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artwork);
        }
        MediaMetadata metadata = metadataBuilder.build();
        mediaSession.setMetadata(metadata);

        long actions =
            PlaybackState.ACTION_PLAY_PAUSE |
            PlaybackState.ACTION_PLAY |
            PlaybackState.ACTION_PAUSE |
            PlaybackState.ACTION_SKIP_TO_NEXT |
            PlaybackState.ACTION_SKIP_TO_PREVIOUS |
            PlaybackState.ACTION_SEEK_TO;
        PlaybackState state = new PlaybackState.Builder()
            .setActions(actions)
            .setState(
                isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                currentPositionMs,
                isPlaying ? 1.0f : 0.0f
            )
            .build();
        mediaSession.setPlaybackState(state);

        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForeground(NOTIFICATION_ID, notification);
        } else {
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, notification);
            }
        }
    }

    private Notification buildNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Action previousAction = buildAction(
            android.R.drawable.ic_media_previous,
            "Previous",
            ACTION_PREVIOUS
        );
        Notification.Action toggleAction = buildAction(
            isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            isPlaying ? "Pause" : "Play",
            ACTION_TOGGLE
        );
        Notification.Action nextAction = buildAction(
            android.R.drawable.ic_media_next,
            "Next",
            ACTION_NEXT
        );

        Notification.MediaStyle style = new Notification.MediaStyle()
            .setMediaSession(mediaSession.getSessionToken())
            .setShowActionsInCompactView(0, 1, 2);

        return new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist.isEmpty() ? "Soundroom" : currentArtist)
            .setSubText(currentAlbum.isEmpty() ? "Soundroom" : currentAlbum)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setLargeIcon(artwork)
            .setColor(0xFFB8873F)
            .setContentIntent(pendingIntent)
            .setStyle(style)
            .addAction(previousAction)
            .addAction(toggleAction)
            .addAction(nextAction)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build();
    }

    private Notification.Action buildAction(int icon, String title, String action) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        PendingIntent pendingIntent = PendingIntent.getService(
            this,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new Notification.Action.Builder(icon, title, pendingIntent).build();
    }

    private void dispatchAction(String action) {
        if (actionListener != null) {
            actionListener.onMediaAction(action);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Soundroom playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Soundroom playback controls.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
