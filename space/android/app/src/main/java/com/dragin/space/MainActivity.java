package com.dragin.space;

import android.os.Bundle;
import com.dragin.space.server.SpaceServerPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpaceServerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
