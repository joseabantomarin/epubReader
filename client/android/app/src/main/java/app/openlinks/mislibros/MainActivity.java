package app.openlinks.mislibros;

import android.view.ActionMode;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private volatile boolean volumeKeysHijacked = true;

    @Override
    public void onStart() {
        super.onStart();
        // Expose AndroidVolume.setHijack(bool) to JS so the reader can turn the
        // volume-keys-turn-pages behavior off while text-to-speech is playing
        // (letting the buttons control the audio volume instead).
        getBridge().getWebView().addJavascriptInterface(this, "AndroidVolume");
    }

    @JavascriptInterface
    public void setHijack(boolean enabled) {
        volumeKeysHijacked = enabled;
    }

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
