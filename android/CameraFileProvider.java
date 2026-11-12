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
        if (!"/capture.jpg".equals(uri.getPath())) throw new FileNotFoundException("Photo not found");
        return new File(getContext().getCacheDir(), "capture.jpg");
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(photo(uri), mode.equals("r") ? ParcelFileDescriptor.MODE_READ_ONLY
                : ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
    }
    @Override public String getType(Uri uri) { return "image/jpeg"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sortOrder) {
        String[] columns = projection == null ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;
        MatrixCursor cursor = new MatrixCursor(columns);
        Object[] values = new Object[columns.length];
        for (int index = 0; index < columns.length; index++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[index])) values[index] = "capture.jpg";
            if (OpenableColumns.SIZE.equals(columns[index])) values[index] = new File(getContext().getCacheDir(), "capture.jpg").length();
        }
        cursor.addRow(values);
        return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
