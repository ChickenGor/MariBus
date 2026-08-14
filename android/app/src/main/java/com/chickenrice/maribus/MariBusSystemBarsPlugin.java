package com.chickenrice.maribus;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MariBusSystemBars")
public class MariBusSystemBarsPlugin extends Plugin {
    @PluginMethod
    public void setTheme(PluginCall call) {
        boolean dark = call.getBoolean("dark", false);
        getActivity().runOnUiThread(() -> {
            applyTheme(getActivity(), dark);
            call.resolve();
        });
    }

    public static void applyTheme(Activity activity, boolean dark) {
        int color = Color.parseColor(dark ? "#000000" : "#FFFFFF");
        Window window = activity.getWindow();
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
        window.getDecorView().setBackground(new ColorDrawable(color));
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }
}
