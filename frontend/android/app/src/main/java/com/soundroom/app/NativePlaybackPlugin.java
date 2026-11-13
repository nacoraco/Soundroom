package com.soundroom.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativePlayback")
public class NativePlaybackPlugin extends Plugin {

    @Override
    public void load() {
        PlaybackService.setPlaybackListener(
            new PlaybackService.PlaybackListener() {
                @Override
                public void onState(JSONObject state) {
                    notifyListeners("playbackState", toJsObject(state));
                }

                @Override
                public void onItemChanged(JSONObject change) {
                    notifyListeners("itemChanged", toJsObject(change));
                }

                @Override
                public void onError(String message) {
                    JSObject payload = new JSObject();
                    payload.put("message", message);
                    notifyListeners("playbackError", payload);
                }
            }
        );
        Intent intent = new Intent(getContext(), PlaybackService.class);
        getContext().startService(intent);
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSONArray items = call.getArray("items");
        int startIndex = call.getInt("startIndex", 0);
        long positionMs = Math.round(call.getDouble("position", 0.0) * 1000.0);
        boolean playWhenReady = Boolean.TRUE.equals(
            call.getBoolean("playWhenReady", false)
        );
        PlaybackService.setQueue(
            items != null ? items : new JSONArray(),
            startIndex,
            positionMs,
            playWhenReady
        );
        call.resolve();
    }

    @PluginMethod
    public void updateQueue(PluginCall call) {
        JSONArray items = call.getArray("items");
        String currentMediaId = call.getString("currentMediaId");
        long positionMs = Math.round(call.getDouble("position", 0.0) * 1000.0);
        boolean playWhenReady = Boolean.TRUE.equals(
            call.getBoolean("playWhenReady", false)
        );
        PlaybackService.updateQueue(
            items != null ? items : new JSONArray(),
            currentMediaId,
            positionMs,
            playWhenReady
        );
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        PlaybackService.play();
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        PlaybackService.pause();
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        long positionMs = Math.round(call.getDouble("position", 0.0) * 1000.0);
        PlaybackService.seekTo(positionMs);
        call.resolve();
    }

    @PluginMethod
    public void next(PluginCall call) {
        PlaybackService.next();
        call.resolve();
    }

    @PluginMethod
    public void previous(PluginCall call) {
        PlaybackService.previous();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        PlaybackService.stop();
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(toJsObject(PlaybackService.getState()));
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService.setPlaybackListener(null);
        super.handleOnDestroy();
    }

    private JSObject toJsObject(JSONObject object) {
        JSObject result = new JSObject();
        if (object == null) {
            return result;
        }
        java.util.Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            try {
                result.put(key, object.get(key));
            } catch (JSONException ignored) {
            }
        }
        return result;
    }
}
