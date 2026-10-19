package be.brokeuh.nightvault;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Printing for Bookcase: Android's web view ignores window.print(), so this hands the current page (the app's print layout) to
 *  Android's own print screen - a printer, or "Save as PDF". */
@CapacitorPlugin(name = "NvPrint")
public class NvPrintPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "Nightvault");
        getActivity().runOnUiThread(() -> {
            try {
                WebView wv = getBridge().getWebView();
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter ad = wv.createPrintDocumentAdapter(name);
                pm.print(name, ad, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) { call.reject("Printing is not available: " + e.getMessage()); }
        });
    }
}
