package be.brokeuh.nightvault;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NvOcrPlugin.class);
        registerPlugin(NvUpdatePlugin.class);
        registerPlugin(NvCapturePlugin.class);
        registerPlugin(NvMediaPlugin.class);
        registerPlugin(NvFilesPlugin.class);
        registerPlugin(NvLogPlugin.class);
        registerPlugin(NvPcPlugin.class);
        registerPlugin(NvPrintPlugin.class);
        registerPlugin(NvBggPlugin.class);
        registerPlugin(NvLaunchPlugin.class);
        super.onCreate(savedInstanceState);
        // files in folders the owner picked (NvFiles) are played straight from there, with byte ranges for seeking
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse r = NvFilesPlugin.serve(getApplicationContext(), request);
                if (r == null) r = NvPcPlugin.serve(getApplicationContext(), request);       // the paired PC on the home network (Take with me)
                return r != null ? r : super.shouldInterceptRequest(view, request);
            }
        });
    }
}
