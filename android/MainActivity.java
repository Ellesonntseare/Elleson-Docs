package za.co.elleson.docs;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.util.Base64;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final int PICK_FILE = 10;
    private static final int SAVE_FILE = 11;
    private static final int GREEN = Color.rgb(21, 82, 62);
    private LinearLayout root;
    private WebView viewer;
    private String origin;
    private String saveUrl;
    private String saveToken;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private byte[] localExport;
    private String localExportId;
    private String localExportVersion;
    private Uri incomingDocument;
    private boolean viewerReady;
    private static final String LOCAL_ORIGIN = "https://appassets.androidplatform.net";

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(GREEN);
        getWindow().setNavigationBarColor(GREEN);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(243, 247, 243));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 35) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            }
            return insets;
        });
        setContentView(root);
        incomingDocument = documentFromIntent(getIntent());
        if (incomingDocument != null) loadViewer(LOCAL_ORIGIN);
        else showConnection();
    }

    private Uri documentFromIntent(Intent intent) {
        if (intent == null) return null;
        Uri uri = Intent.ACTION_VIEW.equals(intent.getAction()) ? intent.getData()
                : Intent.ACTION_SEND.equals(intent.getAction()) ? (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM) : null;
        return uri != null && "content".equals(uri.getScheme()) ? uri : null;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri uri = documentFromIntent(intent);
        if (uri == null) return;
        incomingDocument = uri;
        if (viewer != null && LOCAL_ORIGIN.equals(origin) && viewerReady) importIncomingDocument();
        else loadViewer(LOCAL_ORIGIN);
    }

    private void importIncomingDocument() {
        if (incomingDocument == null || viewer == null || !LOCAL_ORIGIN.equals(origin)) return;
        final Uri uri = incomingDocument;
        final WebView target = viewer;
        incomingDocument = null;
        new Thread(() -> {
            try {
                String name = null;
                try (android.database.Cursor cursor = getContentResolver().query(uri, new String[] { android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                }
                if (name == null) name = "application/pdf".equals(getContentResolver().getType(uri)) ? "document.pdf" : "document.docx";
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                try (InputStream input = getContentResolver().openInputStream(uri)) {
                    if (input == null) throw new IllegalStateException("File unavailable");
                    byte[] buffer = new byte[32768];
                    for (int count; (count = input.read(buffer)) != -1;) {
                        if (bytes.size() + count > 40 * 1024 * 1024) throw new IllegalStateException("Choose a file smaller than 40 MB.");
                        bytes.write(buffer, 0, count);
                    }
                }
                final String script = "window.dispatchEvent(new CustomEvent('elleson-open-file',{detail:{name:"
                    + org.json.JSONObject.quote(name) + ",data:" + org.json.JSONObject.quote(Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)) + "}}))";
                runOnUiThread(() -> { if (viewer == target) target.evaluateJavascript(script, null); });
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this, "Could not open this document. Check its type and size.", Toast.LENGTH_LONG).show());
            }
        }, "elleson-docs-import").start();
    }

    private void showConnection() {
        if (viewer != null) {
            root.removeView(viewer);
            viewer.destroy();
            viewer = null;
        }
        root.removeAllViews();
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(28), dp(24), dp(16));
        ImageView logo = new ImageView(this);
        int resource = getResources().getIdentifier("elleson_docs", "drawable", getPackageName());
        logo.setImageResource(resource);
        content.addView(logo, new LinearLayout.LayoutParams(dp(65), dp(65)));
        TextView title = new TextView(this);
        title.setText("Elleson Docs");
        title.setTextSize(28);
        title.setTextColor(GREEN);
        content.addView(title);
        Button local = new Button(this);
        local.setText("Open documents on phone");
        local.setOnClickListener(view -> loadViewer(LOCAL_ORIGIN));
        content.addView(local);
        TextView help = new TextView(this);
        help.setText("On the PC, choose Connect phone. Enter the address shown there. Both devices need to be on the same Wi-Fi.");
        help.setTextSize(16);
        help.setPadding(0, dp(12), 0, dp(16));
        content.addView(help);
        EditText address = new EditText(this);
        address.setHint("PC address");
        address.setContentDescription("PC address");
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setSingleLine();
        address.setText(getPreferences(MODE_PRIVATE).getString("address", ""));
        content.addView(address);
        Button connect = new Button(this);
        connect.setText("Continue");
        connect.setOnClickListener(view -> {
            String entered = address.getText().toString().trim();
            if (!entered.startsWith("http://")) entered = "http://" + entered;
            Uri parsed = Uri.parse(entered);
            String host = parsed.getHost();
            if (!localAddress(host) || parsed.getPort() < 1 || parsed.getPort() > 65535
                    || parsed.getUserInfo() != null || parsed.getQuery() != null || parsed.getFragment() != null
                    || (parsed.getPath() != null && !parsed.getPath().isEmpty() && !"/".equals(parsed.getPath()))) {
                address.setError("Enter the local IPv4 address and port shown on the PC.");
                return;
            }
            String confirmed = "http://" + host + ":" + parsed.getPort();
            getPreferences(MODE_PRIVATE).edit().putString("address", confirmed).apply();
            ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(address.getWindowToken(), 0);
            loadViewer(confirmed);
        });
        content.addView(connect);
        root.addView(content);
    }

    private static boolean localAddress(String host) {
        if (host == null || !host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] octets = host.split("\\.");
        int first = Integer.parseInt(octets[0]);
        int second = Integer.parseInt(octets[1]);
        for (String octet : octets) if (Integer.parseInt(octet) > 255) return false;
        return first == 10 || first == 192 && second == 168 || first == 172 && second >= 16 && second <= 31
                || first == 169 && second == 254;
    }

    private void loadViewer(String address) {
        viewerReady = false;
        if (viewer != null) viewer.destroy();
        origin = address;
        root.removeAllViews();
        viewer = new WebView(this);
        viewer.getSettings().setJavaScriptEnabled(true);
        viewer.getSettings().setDomStorageEnabled(true);
        viewer.getSettings().setAllowFileAccess(false);
        viewer.getSettings().setAllowContentAccess(true);
        viewer.addJavascriptInterface(new ExportBridge(), "EllesonAndroid");
        viewer.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !matchesOrigin(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (LOCAL_ORIGIN.equals(origin) && matchesOrigin(uri)) {
                    String resource = uri.getPath();
                    if (resource == null || "/".equals(resource)) resource = "/index.html";
                    if (resource.contains("..")) return new WebResourceResponse("text/plain", "UTF-8", null);
                    String mime = resource.endsWith(".mjs") || resource.endsWith(".js") ? "application/javascript"
                            : resource.endsWith(".wasm") ? "application/wasm"
                            : resource.endsWith(".css") ? "text/css" : resource.endsWith(".png") ? "image/png"
                            : resource.endsWith(".html") ? "text/html" : "application/octet-stream";
                    try {
                        return new WebResourceResponse(mime, "UTF-8", getAssets().open("app" + resource));
                    } catch (Exception error) {
                        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found",
                                java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                    }
                }
                if (("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) && !matchesOrigin(uri)) {
                    return new WebResourceResponse("text/plain", "UTF-8", null);
                }
                return null;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                Toast.makeText(MainActivity.this, "Could not reach the PC. Check the address and Wi-Fi.", Toast.LENGTH_LONG).show();
                root.post(() -> { if (viewer == view) showConnection(); });
            }
        });
        viewer.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                boolean image = false;
                for (String accepted : params.getAcceptTypes()) if (accepted.startsWith("image/")) image = true;
                cameraUri = null;
                if (image && params.isCaptureEnabled()) {
                    Intent camera = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
                    cameraUri = Uri.parse("content://za.co.elleson.docs.camera/capture.jpg");
                    camera.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, cameraUri);
                    camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    camera.setClipData(android.content.ClipData.newRawUri("Document photo", cameraUri));
                    try {
                        startActivityForResult(camera, PICK_FILE);
                        return true;
                    } catch (ActivityNotFoundException error) { cameraUri = null; }
                }
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(image ? "image/*" : "*/*");
                if (!image) intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                    "application/pdf", "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                });
                try {
                    startActivityForResult(intent, PICK_FILE);
                    return true;
                } catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    return true;
                }
            }
        });
        root.addView(viewer, new LinearLayout.LayoutParams(-1, 0, 1));
        viewer.loadUrl(address + "/" + (LOCAL_ORIGIN.equals(address) ? "#owner=local" : ""));
    }

    private boolean matchesOrigin(Uri uri) {
        Uri expected = Uri.parse(origin);
        return expected.getScheme().equals(uri.getScheme()) && expected.getHost().equals(uri.getHost()) && expected.getPort() == uri.getPort();
    }

    public final class ExportBridge {
        @JavascriptInterface public void ready() {
            runOnUiThread(() -> { viewerReady = true; importIncomingDocument(); });
        }
        @JavascriptInterface public void printDocument() {
            runOnUiThread(() -> {
                if (viewer == null) return;
                android.print.PrintManager manager = (android.print.PrintManager) getSystemService(PRINT_SERVICE);
                manager.print("Elleson Docs", viewer.createPrintDocumentAdapter("Elleson Docs"), null);
            });
        }
        @JavascriptInterface public void connectPC() {
            runOnUiThread(() -> showConnection());
        }
        @JavascriptInterface public void saveData(String data, String name, String id, String version) {
            runOnUiThread(() -> {
                if (viewer == null || saveUrl != null) return;
                if (data.length() > 80000000) {
                    Toast.makeText(MainActivity.this, "This copy is too large to save on the phone.", Toast.LENGTH_LONG).show();
                    return;
                }
                try {
                    localExport = Base64.decode(data, Base64.DEFAULT);
                    localExportId = id;
                    localExportVersion = version;
                    saveUrl = "local";
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(name.toLowerCase(java.util.Locale.ROOT).endsWith(".pdf") ? "application/pdf"
                            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
                    intent.putExtra(Intent.EXTRA_TITLE, name);
                    startActivityForResult(intent, SAVE_FILE);
                } catch (Exception error) {
                    localExport = null;
                    saveUrl = null;
                    Toast.makeText(MainActivity.this, "Could not prepare the file.", Toast.LENGTH_LONG).show();
                }
            });
        }
        @JavascriptInterface public void save(String url, String token, String name) {
            runOnUiThread(() -> {
                Uri uri = Uri.parse(url);
                if (!matchesOrigin(uri) || uri.getPath() == null || !uri.getPath().matches("/api/save/[0-9a-f-]{36}")
                        || !token.matches("[A-Za-z0-9_-]{32}") || saveUrl != null) return;
                String type = name.toLowerCase(java.util.Locale.ROOT).endsWith(".pdf") ? "application/pdf"
                        : name.toLowerCase(java.util.Locale.ROOT).endsWith(".doc") ? "application/msword"
                        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(type);
                intent.putExtra(Intent.EXTRA_TITLE, name);
                saveUrl = url;
                saveToken = token;
                try {
                    startActivityForResult(intent, SAVE_FILE);
                } catch (ActivityNotFoundException error) {
                    saveUrl = saveToken = null;
                    Toast.makeText(MainActivity.this, "No file picker is available.", Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && fileCallback != null) {
            Uri selected = result == RESULT_OK ? cameraUri != null ? cameraUri : data != null ? data.getData() : null : null;
            Uri[] selection = selected == null ? null : new Uri[] { selected };
            cameraUri = null;
            fileCallback.onReceiveValue(selection);
            fileCallback = null;
        }
        if (request == SAVE_FILE) {
            String url = saveUrl;
            String token = saveToken;
            byte[] bytes = localExport;
            String documentId = localExportId;
            String version = localExportVersion;
            localExport = null;
            saveUrl = saveToken = null;
            if (result == RESULT_OK && data != null && data.getData() != null && url != null) {
                new Thread(() -> {
                    if ("local".equals(url)) writeLocal(bytes, data.getData(), documentId, version);
                    else writeExport(url, token, data.getData());
                }, "elleson-docs-export").start();
            }
        }
    }

    private void writeLocal(byte[] bytes, Uri target, String id, String version) {
        String message = "Copy saved";
        try {
            try (OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                if (output == null || bytes == null) throw new IllegalStateException("Save location unavailable");
                output.write(bytes);
            }
            runOnUiThread(() -> {
                if (viewer != null && LOCAL_ORIGIN.equals(origin)) viewer.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('elleson-local-saved',{detail:{id:"
                    + org.json.JSONObject.quote(id) + ",version:" + org.json.JSONObject.quote(version) + "}}))", null);
            });
        } catch (Exception error) {
            message = "Could not save the copy.";
        }
        final String result = message;
        runOnUiThread(() -> Toast.makeText(this, result, Toast.LENGTH_LONG).show());
    }

    private void writeExport(String url, String token, Uri target) {
        String message = "Copy saved";
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url + (url.contains("?") ? "&" : "?") + "ack=1").openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(45000);
            if (connection.getResponseCode() != 200) throw new IllegalStateException("Export unavailable.");
            String receipt = connection.getHeaderField("X-Elleson-Save-Receipt");
            try (InputStream input = connection.getInputStream(); OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                if (output == null) throw new IllegalStateException("Could not open the save location.");
                byte[] buffer = new byte[32768];
                for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
            }
            if (receipt != null && receipt.matches("[A-Za-z0-9_-]{32}")) {
                HttpURLConnection acknowledgement = null;
                try {
                    Uri exportUri = Uri.parse(url);
                    acknowledgement = (HttpURLConnection) new URL(exportUri.getScheme() + "://" + exportUri.getAuthority() + "/api/saved/" + receipt).openConnection();
                    acknowledgement.setInstanceFollowRedirects(false);
                    acknowledgement.setRequestMethod("POST");
                    acknowledgement.setRequestProperty("Authorization", "Bearer " + token);
                    acknowledgement.setConnectTimeout(10000);
                    acknowledgement.setReadTimeout(15000);
                    if (acknowledgement.getResponseCode() != 204) message = "Copy saved. Could not confirm it with the PC.";
                } catch (Exception error) { message = "Copy saved. Could not confirm it with the PC."; }
                finally { if (acknowledgement != null) acknowledgement.disconnect(); }
            }
        } catch (Exception error) {
            message = "Could not save the copy.";
        } finally {
            if (connection != null) connection.disconnect();
        }
        final String result = message;
        runOnUiThread(() -> Toast.makeText(this, result, Toast.LENGTH_LONG).show());
    }

    @Override public void onBackPressed() {
        if (viewer != null) showConnection();
        else super.onBackPressed();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
