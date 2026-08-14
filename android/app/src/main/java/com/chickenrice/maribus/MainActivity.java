package com.chickenrice.maribus;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MariBusSystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
        MariBusSystemBarsPlugin.applyTheme(this, false);
    }
}
