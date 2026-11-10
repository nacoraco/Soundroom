package com.soundroom.app;

import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeMediaSession")
public class NativeMediaSessionPlugin extends Plugin {

    private Handler handler;
    private Runnable injector;

    @Override
    public void load() {
        PlaybackService.setActionListener((action) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            notifyListeners("mediaAction", data);
        });

        handler = new Handler(Looper.getMainLooper());
        injector = new Runnable() {
            @Override
            public void run() {
                WebView webView = getBridge().getWebView();
                if (webView != null) {
                    webView.evaluateJavascript(NATIVE_MEDIA_BRIDGE_SCRIPT, null);
                }
                handler.postDelayed(this, 5000);
            }
        };
        handler.postDelayed(injector, 4000);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "Soundroom");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        long durationMs = Math.round(call.getDouble("duration", 0.0) * 1000.0);
        boolean isPlaying = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));
        long positionMs = Math.round(call.getDouble("position", 0.0) * 1000.0);
        PlaybackService.updateMediaSession(title, artist, album, durationMs, isPlaying, positionMs);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        PlaybackService.clearMediaSession();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (handler != null && injector != null) {
            handler.removeCallbacks(injector);
        }
        PlaybackService.setActionListener(null);
        super.handleOnDestroy();
    }

    private static final String NATIVE_MEDIA_BRIDGE_SCRIPT =
        "(function () {\n" +
        "  if (window.__soundroomNativeMediaBridge) return 'already';\n" +
        "  if (window.__soundroomWebNativeMediaBridge) return 'app-bridge-present';\n" +
        "  const capacitor = window.Capacitor;\n" +
        "  const plugin = capacitor && capacitor.Plugins && capacitor.Plugins.NativeMediaSession;\n" +
        "  if (!plugin) return 'waiting-for-capacitor';\n" +
        "  window.__soundroomNativeMediaBridge = true;\n" +
        "  const update = function () {\n" +
        "    const audio = document.querySelector('audio');\n" +
        "    const title = document.querySelector('.player-bar-title')?.textContent?.trim();\n" +
        "    if (!title) return;\n" +
        "    const artist = document.querySelector('.player-bar-artist')?.textContent?.trim() || '';\n" +
        "    const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;\n" +
        "    plugin.update({\n" +
        "      title: title,\n" +
        "      artist: artist,\n" +
        "      album: 'Soundroom',\n" +
        "      duration: duration,\n" +
        "      isPlaying: audio ? !audio.paused : false,\n" +
        "      position: audio ? audio.currentTime : 0\n" +
        "    }).catch(function () {});\n" +
        "  };\n" +
        "  const attachAudioEvents = function () {\n" +
        "    const audio = document.querySelector('audio');\n" +
        "    if (!audio || audio.__soundroomNativeEvents) return;\n" +
        "    audio.__soundroomNativeEvents = true;\n" +
        "    ['play', 'pause', 'ended', 'loadedmetadata', 'seeked'].forEach(function (event) {\n" +
        "      audio.addEventListener(event, update);\n" +
        "    });\n" +
        "  };\n" +
        "  attachAudioEvents();\n" +
        "  setInterval(function () {\n" +
        "    attachAudioEvents();\n" +
        "    update();\n" +
        "  }, 2000);\n" +
        "  plugin.addListener('mediaAction', function (data) {\n" +
        "    const action = data && data.action;\n" +
        "    if (action === 'play' || action === 'pause') {\n" +
        "      const button = document.querySelector('button[aria-label=\"Play\"], button[aria-label=\"Pause\"]');\n" +
        "      if (button) button.click();\n" +
        "    } else if (action === 'next') {\n" +
        "      const button = document.querySelector('button[aria-label=\"Next track\"]');\n" +
        "      if (button) button.click();\n" +
        "    } else if (action === 'previous') {\n" +
        "      const button = document.querySelector('button[aria-label=\"Previous track\"]');\n" +
        "      if (button) button.click();\n" +
        "    } else if (action && action.indexOf('seek:') === 0) {\n" +
        "      const milliseconds = Number(action.slice(5));\n" +
        "      const audio = document.querySelector('audio');\n" +
        "      if (audio && Number.isFinite(milliseconds)) audio.currentTime = milliseconds / 1000;\n" +
        "    }\n" +
        "  });\n" +
        "  update();\n" +
        "  return 'installed';\n" +
        "})()";
}
