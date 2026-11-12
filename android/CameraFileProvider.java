package za.co.elleson.docs;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public final class CameraFileProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    private File photo(Uri uri) throws FileNotFoundException {
        if (uri.getPath() != null && uri.getPath().matches("/shared/[a-f0-9-]{36}/[A-Za-z0-9_. -]+")) return new File(getContext().getCacheDir(), uri.getPath().substring(1));
        if (!"/capture.jpg".equals(uri.getPath())) throw new FileNotFoundException("Photo not found");
        return new File(getContext().getCacheDir(), "capture.jpg");
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (uri.getPath().startsWith("/shared/") && !"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(photo(uri), mode.equals("r") ? ParcelFileDescriptor.MODE_READ_ONLY
                : ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
    }
    @Override public String getType(Uri uri) {
        String name = uri.getLastPathSegment(), extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.ROOT);
        String type = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return type == null ? "application/octet-stream" : type;
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sortOrder) {
        String[] columns = projection == null ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;
        MatrixCursor cursor = new MatrixCursor(columns);
        Object[] values = new Object[columns.length];
        for (int index = 0; index < columns.length; index++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[index])) values[index] = uri.getLastPathSegment();
            if (OpenableColumns.SIZE.equals(columns[index])) { try { values[index] = photo(uri).length(); } catch (FileNotFoundException error) { values[index] = 0; } }
        }
        cursor.addRow(values);
        return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
