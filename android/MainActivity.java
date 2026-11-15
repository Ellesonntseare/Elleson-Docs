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
    private String localExportReceipt = "";
    private Uri incomingDocument;
    private boolean viewerReady;
    private volatile boolean updateDownloading;
    private Uri pendingSource;
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
        else {
            String remembered = getPreferences(MODE_PRIVATE).getString("address", "");
            if (!remembered.isEmpty()) loadViewer(remembered);
            else showConnection();
        }
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
        pendingSource = uri;
        final WebView target = viewer;
        incomingDocument = null;
        new Thread(() -> {
            try {
                String name = null;
                try (android.database.Cursor cursor = getContentResolver().query(uri, new String[] { android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                }
                String type = getContentResolver().getType(uri);
                if (name == null) {
                    String extension = "application/pdf".equals(type) ? "pdf" : "docx";
                    if ("image/jpeg".equals(type)) extension = "jpg";
                    else if ("image/png".equals(type)) extension = "png";
                    else if ("image/webp".equals(type)) extension = "webp";
                    else if ("image/gif".equals(type)) extension = "gif";
                    else if ("image/bmp".equals(type)) extension = "bmp";
                    name = "document." + extension;
                }
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
                    + org.json.JSONObject.quote(name) + ",type:" + org.json.JSONObject.quote(type == null ? "" : type) + ",data:" + org.json.JSONObject.quote(Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)) + "}}))";
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
        help.setText("The app connects to a PC on your Wi-Fi automatically. No codes or approval prompts are needed. You can also enter an address manually.");
        help.setTextSize(16);
        help.setPadding(0, dp(12), 0, dp(16));
        content.addView(help);
        LinearLayout discovered = new LinearLayout(this);
        discovered.setOrientation(LinearLayout.VERTICAL);
        content.addView(discovered);
        Button search = new Button(this); search.setText("Find PCs on Wi-Fi"); content.addView(search);
        search.setOnClickListener(view -> discoverPCs(discovered, search));
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
        discoverPCs(discovered, search);
    }

    private void discoverPCs(LinearLayout list, Button search) {
        list.removeAllViews(); search.setEnabled(false); search.setText("Looking for PCs…");
        new Thread(() -> {
            java.util.HashSet<String> found = new java.util.HashSet<>();
            try (java.net.DatagramSocket socket = new java.net.DatagramSocket()) {
                socket.setBroadcast(true); socket.setSoTimeout(1000);
                byte[] query = "ELLESON_DOCS_DISCOVER_V1".getBytes(StandardCharsets.UTF_8);
                for (int attempt = 0; attempt < 3; attempt++) {
                    socket.send(new java.net.DatagramPacket(query, query.length, java.net.InetAddress.getByName("255.255.255.255"), 16944));
                    long until = System.currentTimeMillis() + 1200;
                    while (System.currentTimeMillis() < until) {
                        try {
                            java.net.DatagramPacket packet = new java.net.DatagramPacket(new byte[1024], 1024); socket.receive(packet);
                            org.json.JSONObject data = new org.json.JSONObject(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
                            String ip = packet.getAddress().getHostAddress(); int port = data.optInt("port");
                            if (!"elleson-docs".equals(data.optString("service")) || !localAddress(ip) || port < 1 || port > 65535) continue;
                            String address = "http://" + ip + ":" + port;
                            if (!found.add(address)) continue;
                            String name = data.optString("name", "PC");
                            final boolean firstPC = found.size() == 1;
                            runOnUiThread(() -> {
                                if (!list.isAttachedToWindow()) return;
                                Button pc = new Button(this); pc.setText("Connect to " + name);
                                pc.setOnClickListener(view -> { getPreferences(MODE_PRIVATE).edit().putString("address", address).apply(); loadViewer(address); });
                                list.addView(pc);
                                if (firstPC) { getPreferences(MODE_PRIVATE).edit().putString("address", address).apply(); loadViewer(address); }
                            });
                        } catch (java.net.SocketTimeoutException ignored) { }
                    }
                }
            } catch (Exception ignored) { }
            runOnUiThread(() -> { search.setEnabled(true); search.setText("Find PCs on Wi-Fi"); if (found.isEmpty() && list.isAttachedToWindow()) { TextView empty = new TextView(this); empty.setText("No PC found. Open Elleson Docs on the PC, check Wi-Fi, or use its address below."); list.addView(empty); } });
        }, "elleson-discovery").start();
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
        viewer.getSettings().setTextZoom(100);
        viewer.getSettings().setAllowFileAccess(false);
        viewer.getSettings().setAllowContentAccess(true);
        viewer.addJavascriptInterface(new ExportBridge(), "EllesonAndroid");
        viewer.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !matchesOrigin(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && "api.github.com".equals(uri.getHost()) && "/repos/Ellesonntseare/Elleson-Docs/releases".equals(uri.getPath()) && "GET".equals(request.getMethod())) return null;
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
                boolean acceptsImage = false, acceptsOther = false;
                for (String value : params.getAcceptTypes()) {
                    for (String type : value.split(",")) {
                        String accepted = type.trim().toLowerCase(java.util.Locale.ROOT);
                        if (accepted.startsWith("image/") || accepted.matches("\\.(png|jpe?g|webp|gif|bmp)")) acceptsImage = true;
                        else if (!accepted.isEmpty()) acceptsOther = true;
                    }
                }
                boolean image = acceptsImage && !acceptsOther;
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
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                intent.setType(image ? "image/*" : "*/*");
                boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
                if (!image && !multiple) intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                    "application/pdf", "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"
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

    private void updateStatus(String message) {
        runOnUiThread(() -> { if (viewer != null) viewer.evaluateJavascript("window.dispatchEvent(new CustomEvent('elleson-update-status',{detail:" + org.json.JSONObject.quote(message) + "}))", null); });
    }
    public final class ExportBridge {
        @JavascriptInterface public String appVersion() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception error) { return "0.4.10"; }
        }
        private boolean localUpdate(String address) {
            if(address==null||LOCAL_ORIGIN.equals(origin))return false;
            Uri uri=Uri.parse(address);
            return matchesOrigin(uri)&&"http".equals(uri.getScheme())&&"/api/local-update/android.apk".equals(uri.getPath())&&uri.getQuery()==null&&uri.getFragment()==null;
        }
        @JavascriptInterface public void installUpdate(String address, String digest) {
            if (updateDownloading) return;
            if ((address == null || (!localUpdate(address) && !address.startsWith("https://github.com/Ellesonntseare/Elleson-Docs/releases/download/")) || !address.endsWith(".apk")) || digest == null || !digest.matches("sha256:[a-f0-9]{64}")) { updateStatus("The update download is invalid."); return; }
            if (!getPackageManager().canRequestPackageInstalls()) {
                runOnUiThread(() -> { updateStatus("Allow updates from Elleson Docs, then tap Download update again."); startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); });
                return;
            }
            updateDownloading = true;
            new Thread(() -> {
                java.io.File output = null;
                try {
                    String relative = "shared/" + java.util.UUID.randomUUID() + "/Elleson-Docs-update.apk";
                    output = new java.io.File(getCacheDir(), relative); output.getParentFile().mkdirs();
                    URL location = new URL(address); HttpURLConnection connection = null;
                    for (int redirects = 0; redirects < 6; redirects++) {
                        String hostname = location.getHost();
                        if (!localUpdate(location.toString()) && (!"https".equals(location.getProtocol()) || !("github.com".equals(hostname) || "release-assets.githubusercontent.com".equals(hostname) || "objects.githubusercontent.com".equals(hostname)))) throw new java.io.IOException("Unexpected download address.");
                        connection = (HttpURLConnection) location.openConnection(); connection.setConnectTimeout(15000); connection.setReadTimeout(30000); connection.setInstanceFollowRedirects(false);
                        int code = connection.getResponseCode();
                        if (code >= 300 && code < 400) { URL next = new URL(location, connection.getHeaderField("Location")); connection.disconnect(); location = next; continue; }
                        if (code != 200) throw new java.io.IOException("The update could not be downloaded.");
                        break;
                    }
                    if (connection == null || connection.getResponseCode() != 200) throw new java.io.IOException("Too many download redirects.");
                    java.security.MessageDigest checksum = java.security.MessageDigest.getInstance("SHA-256");
                    try (InputStream input = connection.getInputStream(); java.io.FileOutputStream stream = new java.io.FileOutputStream(output)) {
                        byte[] buffer = new byte[65536]; int count; long total = 0, previousProgress = 0;
                        long expected = connection.getContentLengthLong();
                        while ((count = input.read(buffer)) != -1) { total += count; if (total > 160 * 1024 * 1024) throw new java.io.IOException("Update is too large."); checksum.update(buffer, 0, count); stream.write(buffer, 0, count); if(total-previousProgress>=1024*1024){previousProgress=total;updateStatus(expected>0?"Downloading update: "+Math.min(100,total*100/expected)+"%":"Downloading update: "+total/(1024*1024)+" MB");} }
                        stream.getFD().sync();
                    } finally { connection.disconnect(); }
                    StringBuilder actual = new StringBuilder(); for (byte value : checksum.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                    if (!digest.substring(7).equals(actual.toString())) throw new java.io.IOException("Update checksum failed. Try downloading again.");
                    android.content.pm.PackageInfo installed = getPackageManager().getPackageInfo(getPackageName(), android.content.pm.PackageManager.GET_SIGNATURES);
                    android.content.pm.PackageInfo candidate = getPackageManager().getPackageArchiveInfo(output.getAbsolutePath(), android.content.pm.PackageManager.GET_SIGNATURES);
                    if (candidate == null || !getPackageName().equals(candidate.packageName) || candidate.versionCode <= installed.versionCode || !java.util.Arrays.equals(installed.signatures, candidate.signatures)) throw new java.io.IOException("This update does not match the installed app or is not newer.");
                    Uri uri = Uri.parse("content://za.co.elleson.docs.camera/" + relative);
                    runOnUiThread(() -> { Intent install = new Intent(Intent.ACTION_VIEW); install.setDataAndType(uri, "application/vnd.android.package-archive"); install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); install.setClipData(android.content.ClipData.newRawUri("App update", uri)); startActivity(install); updateStatus("Update verified. Confirm installation in Android."); });
                } catch (Exception error) { if (output != null) output.delete(); updateStatus("Update failed: " + error.getMessage()); }
                finally { updateDownloading = false; }
            }, "elleson-update").start();
        }
        @JavascriptInterface public void handoff(String data, String name, int page, double zoom, boolean toPC) {
            if (data == null || data.length() > 57000000) return;
            try {
                org.json.JSONObject packet = new org.json.JSONObject();
                packet.put("data", data); packet.put("name", name); packet.put("page", page); packet.put("zoom", zoom); packet.put("target", toPC ? "pc" : "phone");
                try (OutputStream output = new java.io.FileOutputStream(new java.io.File(getFilesDir(), "handoff.json"))) {
                    output.write(packet.toString().getBytes(StandardCharsets.UTF_8));
                }
                runOnUiThread(() -> { if (toPC) showConnection(); else loadViewer(LOCAL_ORIGIN); });
            } catch (Exception error) { runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not prepare document handoff. Your current document is still available.", Toast.LENGTH_LONG).show()); }
        }
        @JavascriptInterface public String pendingHandoff() {
            try { return new String(java.nio.file.Files.readAllBytes(new java.io.File(getFilesDir(), "handoff.json").toPath()), StandardCharsets.UTF_8); }
            catch (Exception error) { return ""; }
        }
        @JavascriptInterface public void finishHandoff() { new java.io.File(getFilesDir(), "handoff.json").delete(); }
        @JavascriptInterface public void rememberSource(String id) {
            final Uri uri = pendingSource;
            if (uri == null || id == null) return;
            pendingSource = null;
            new Thread(() -> {
                try { getPreferences(MODE_PRIVATE).edit().putString("source-" + id, uri.toString()).putString("hash-" + id, hashUri(uri)).apply(); }
                catch (Exception ignored) {}
            }).start();
        }
        @JavascriptInterface public boolean saveOriginalData(String data, String name, String id, String version, String receipt) {
            String savedUri = getPreferences(MODE_PRIVATE).getString("source-" + id, null);
            String expected = getPreferences(MODE_PRIVATE).getString("hash-" + id, null);
            if (savedUri == null || expected == null || data.length() > 80000000) return false;
            new Thread(() -> {
                Uri uri = Uri.parse(savedUri);
                try {
                    String actual = hashUri(uri);
                    byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                    Runnable write = () -> new Thread(() -> {
                        try {
                            // Some document providers cannot replace atomically. Retain
                            // both the original and pending content before truncating.
                            retainSaveBackup(uri, id, bytes);
                            try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                                if (output == null) throw new IllegalStateException();
                                output.write(bytes);
                            }
                            getPreferences(MODE_PRIVATE).edit().putString("hash-" + id, hashUri(uri)).apply();
                            runOnUiThread(() -> {
                                if (viewer != null) viewer.evaluateJavascript("window.dispatchEvent(new CustomEvent('elleson-save-ack',{detail:{id:"
                                    + org.json.JSONObject.quote(id) + ",version:" + org.json.JSONObject.quote(version) + ",receipt:" + org.json.JSONObject.quote(receipt) + "}}))", null);
                                Toast.makeText(MainActivity.this, "Saved to the opened file", Toast.LENGTH_LONG).show();
                            });
                        } catch (Exception error) { fallbackCopy(data, name, id, version, receipt); }
                    }).start();
                    if (!actual.equals(expected)) runOnUiThread(() -> new android.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle("File changed outside Elleson Docs").setMessage("Choose a copy to keep both versions.")
                        .setNegativeButton("Cancel", null).setNeutralButton("Save a copy", (dialog, which) -> fallbackCopy(data, name, id, version, receipt))
                        .setPositiveButton("Overwrite", (dialog, which) -> write.run()).show());
                    else write.run();
                } catch (Exception error) { fallbackCopy(data, name, id, version, receipt); }
            }, "elleson-docs-save-original").start();
            return true;
        }
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
                    String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.ROOT);
                    String mime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                    intent.setType(mime == null ? "application/octet-stream" : mime);
                    intent.putExtra(Intent.EXTRA_TITLE, name);
                    startActivityForResult(intent, SAVE_FILE);
                } catch (Exception error) {
                    localExport = null;
                    saveUrl = null;
                    Toast.makeText(MainActivity.this, "Could not prepare the file.", Toast.LENGTH_LONG).show();
                }
            });
        }
        @JavascriptInterface public void shareData(String data, String name, String mime) {
            if (data.length() > 80000000) return;
            new Thread(() -> {
                try {
                    String safe = name.replaceAll("[^A-Za-z0-9_. -]", "_"); if (safe.length() > 180) safe = safe.substring(safe.length() - 180);
                    String relative = "shared/" + java.util.UUID.randomUUID().toString() + "/" + safe;
                    java.io.File file = new java.io.File(getCacheDir(), relative); file.getParentFile().mkdirs();
                    try (OutputStream output = new java.io.FileOutputStream(file)) { output.write(Base64.decode(data, Base64.DEFAULT)); }
                    Uri uri = Uri.parse("content://za.co.elleson.docs.camera/" + relative);
                    runOnUiThread(() -> {
                        Intent send = new Intent(Intent.ACTION_SEND); send.setType(getContentResolver().getType(uri));
                        send.putExtra(Intent.EXTRA_STREAM, uri); send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        send.setClipData(android.content.ClipData.newRawUri("Document", uri));
                        try { startActivity(Intent.createChooser(send, "Share document")); } catch (Exception error) { Toast.makeText(MainActivity.this, "No sharing app is available.", Toast.LENGTH_LONG).show(); }
                    });
                } catch (Exception error) { runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not prepare sharing.", Toast.LENGTH_LONG).show()); }
            }, "elleson-share").start();
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
            if (selected != null && cameraUri == null) {
                pendingSource = selected;
                try { getContentResolver().takePersistableUriPermission(selected, data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)); } catch (Exception ignored) {}
            }
            Uri[] selection = selected == null ? null : new Uri[] { selected };
            if (result == RESULT_OK && data != null && data.getClipData() != null) {
                android.content.ClipData clips = data.getClipData(); selection = new Uri[clips.getItemCount()];
                for (int i = 0; i < selection.length; i++) selection[i] = clips.getItemAt(i).getUri();
            }
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
            String receipt = localExportReceipt;
            localExportReceipt = "";
            localExport = null;
            saveUrl = saveToken = null;
            if (result == RESULT_OK && data != null && data.getData() != null && url != null) {
                new Thread(() -> {
                    if ("local".equals(url)) writeLocal(bytes, data.getData(), documentId, version, receipt);
                    else writeExport(url, token, data.getData());
                }, "elleson-docs-export").start();
            }
        }
    }

    private void retainSaveBackup(Uri uri, String id, byte[] pending) throws Exception {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid document");
        java.io.File directory = new java.io.File(getFilesDir(), "save-recovery");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new java.io.IOException("Recovery storage unavailable");
        java.io.File original = new java.io.File(directory, id + "-original.bin");
        java.io.File temporary = new java.io.File(directory, id + "-original.tmp");
        try (InputStream input = getContentResolver().openInputStream(uri); java.io.FileOutputStream output = new java.io.FileOutputStream(temporary)) {
            if (input == null) throw new java.io.IOException("Original unavailable");
            byte[] buffer = new byte[32768];
            for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
            output.getFD().sync();
        }
        java.nio.file.Files.move(temporary.toPath(), original.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        try (java.io.FileOutputStream output = new java.io.FileOutputStream(new java.io.File(directory, id + "-pending.bin"))) {
            output.write(pending); output.getFD().sync();
        }
    }

    private void writeLocal(byte[] bytes, Uri target, String id, String version, String receipt) {
        String message = "Copy saved";
        try {
            try (OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                if (output == null || bytes == null) throw new IllegalStateException("Save location unavailable");
                output.write(bytes);
            }
            runOnUiThread(() -> {
                if (viewer != null && receipt != null && !receipt.isEmpty()) viewer.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('elleson-save-ack',{detail:{id:" + org.json.JSONObject.quote(id)
                    + ",version:" + org.json.JSONObject.quote(version) + ",receipt:" + org.json.JSONObject.quote(receipt) + "}}))", null);
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
    private void fallbackCopy(String data, String name, String id, String version, String receipt) {
        runOnUiThread(() -> { if (saveUrl != null) return; localExportReceipt = receipt; new ExportBridge().saveData(data, name, id, version); });
    }
    private String hashUri(Uri uri) throws Exception {
        java.security.MessageDigest hash = java.security.MessageDigest.getInstance("SHA-256");
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException();
            byte[] buffer = new byte[32768];
            for (int count; (count = input.read(buffer)) != -1;) hash.update(buffer, 0, count);
        }
        return Base64.encodeToString(hash.digest(), Base64.NO_WRAP);
    }
}
