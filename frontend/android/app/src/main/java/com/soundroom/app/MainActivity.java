package com.soundroom.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlaybackPlugin.class);
        super.onCreate(savedInstanceState);

        Intent serviceIntent = new Intent(this, PlaybackService.class);
        startService(serviceIntent);

        if (BuildConfig.DEBUG) {
            String testQueue = getIntent().getStringExtra(
                "soundroom_test_queue"
            );
            if (testQueue != null) {
                try {
                    PlaybackService.setQueue(
                        new JSONArray(testQueue),
                        0,
                        0,
                        true
                    );
                } catch (Exception ignored) {
                }
            }
        }
    }
}
