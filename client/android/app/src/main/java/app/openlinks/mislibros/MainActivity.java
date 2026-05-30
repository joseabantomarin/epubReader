package app.openlinks.mislibros;

import android.view.ActionMode;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean volumeKeysHijacked = true;

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (volumeKeysHijacked && (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                String name = code == KeyEvent.KEYCODE_VOLUME_UP ? "volumeUp" : "volumeDown";
                String js = "window.dispatchEvent(new CustomEvent('hardwareVolume', { detail: '" + name + "' }))";
                getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
            }
            return true; // consume the event so OS doesn't change media volume
        }
        return super.dispatchKeyEvent(event);
    }

    // Suppress the system text-selection floating toolbar (Copy / Share /
    // Search…). The web layer renders its own menu via selectionchange events
    // — the selection itself is still allowed, so JS hears about it.
    @Override
    public void onActionModeStarted(ActionMode mode) {
        if (mode != null) mode.finish();
        super.onActionModeStarted(mode);
    }
}
