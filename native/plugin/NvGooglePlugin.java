package be.brokeuh.nightvault;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import java.util.Arrays;

/** "Sign in with Google" for Bookcase's Google Drive books (owner, 22 Oct / 2 Nov 2026): Google's own sign-in screen
 *  (Identity AuthorizationClient), only the right to LOOK at Drive files (drive.readonly). Returns a short-lived access token;
 *  calling authorize again later gives a fresh one without a screen once it was allowed.
 *  Needs an "Android" OAuth client in the owner's Google console: package be.brokeuh.nightvault + the SHA-1 of native/debug.keystore. */
@CapacitorPlugin(name = "NvGoogle", requestCodes = {NvGooglePlugin.REQ})
public class NvGooglePlugin extends Plugin {
    static final int REQ = 7711;
    private PluginCall pending;

    @PluginMethod
    public void authorize(PluginCall call) {
        String scope = call.getString("scope", "https://www.googleapis.com/auth/drive.readonly");
        boolean interactive = call.getBoolean("interactive", true);
        AuthorizationRequest req = AuthorizationRequest.builder().setRequestedScopes(Arrays.asList(new Scope(scope))).build();
        Identity.getAuthorizationClient(getActivity()).authorize(req)
            .addOnSuccessListener(res -> {
                if (res.hasResolution()) {
                    if (!interactive) { JSObject o = new JSObject(); o.put("needsSignIn", true); call.resolve(o); return; }
                    PendingIntent pi = res.getPendingIntent();
                    try {
                        pending = call;
                        getActivity().startIntentSenderForResult(pi.getIntentSender(), REQ, null, 0, 0, 0);
                    } catch (IntentSender.SendIntentException e) { pending = null; call.reject("Could not open Google's sign-in: " + e.getMessage()); }
                } else resolveWith(call, res);
            })
            .addOnFailureListener(e -> call.reject(msg(e)));
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ || pending == null) return;
        PluginCall c = pending; pending = null;
        if (resultCode != Activity.RESULT_OK) { c.reject("Sign-in was cancelled"); return; }
        try { resolveWith(c, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data)); }
        catch (ApiException e) { c.reject(msg(e)); }
    }

    private void resolveWith(PluginCall c, AuthorizationResult res) {
        JSObject o = new JSObject();
        o.put("token", res.getAccessToken());
        o.put("scopes", new JSArray(res.getGrantedScopes()));
        c.resolve(o);
    }

    private String msg(Exception e) {
        if (e instanceof ApiException) {
            int code = ((ApiException) e).getStatusCode();
            if (code == 10) return "Google doesn't know this app yet (code 10): the Android client in Google's console is missing, or its package name / SHA-1 is not right";
            return "Google sign-in failed (code " + code + "): " + e.getMessage();
        }
        return "Google sign-in failed: " + e.getMessage();
    }
}
