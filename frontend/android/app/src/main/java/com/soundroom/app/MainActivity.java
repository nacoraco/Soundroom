package com.soundroom.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlaybackPlugin.class);
        super.onCreate(savedInstanceState);

        Intent serviceIntent = new Intent(this, PlaybackService.class);
        startService(serviceIntent);
    }
}
