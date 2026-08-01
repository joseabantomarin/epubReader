package app.openlinks.mislibros;

import android.app.DownloadManager;
import android.net.Uri;
import android.os.Environment;
import android.view.ActionMode;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.widget.Toast;
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
        setupDownloads();
    }

    // El WebView no descarga por su cuenta: cuando la web pide bajar un libro
    // (original o PDF), pasamos la URL al gestor de descargas del sistema, que
    // la guarda en Descargas y muestra la notificación de progreso. El token de
    // sesión viaja en la query, así que la petición del gestor va autenticada.
    private void setupDownloads() {
        getBridge().getWebView().setDownloadListener(
            (url, userAgent, contentDisposition, mimeType, contentLength) -> {
                try {
                    String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.addRequestHeader("User-Agent", userAgent);
                    request.setMimeType(mimeType);
                    request.setTitle(name);
                    request.setDescription("MisLibros");
                    request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm == null) return;
                    dm.enqueue(request);
                    Toast.makeText(this, "Descargando " + name, Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "No se pudo iniciar la descarga", Toast.LENGTH_LONG).show();
                }
            });
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
