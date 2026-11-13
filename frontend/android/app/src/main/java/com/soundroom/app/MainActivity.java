package com.soundroom.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlaybackPlugin.class);
        super.onCreate(savedInstanceState);

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                1001
            );
        }

        Intent serviceIntent = new Intent(this, PlaybackService.class);
        startService(serviceIntent);
    }
}
