package be.brokeuh.nightvault;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NvOcrPlugin.class);
        registerPlugin(NvUpdatePlugin.class);
        registerPlugin(NvCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
