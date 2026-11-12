# Elleson Docs

Elleson Docs 0.1.0 is an initial Windows document viewer and editor with a paired Android companion.

Open a PDF, scanned PDF, DOC, or DOCX on the PC. Pair the phone over the same local Wi-Fi using the PC address and a temporary code. Either device can open a new file, fill supported PDF fields, add text, draw, edit supported existing PDF text, edit Word paragraphs, and save a copy. Page selection and zoom belong to each device independently.

## Current capabilities

- PDF page rendering, page thumbnails, zoom, selectable text, and document search.
- Existing PDF text replacement with the extracted font, size, color, and baseline. Replacement characters must exist in the font. The app rejects a replacement that exceeds the available line width.
- English OCR runs locally using bundled language data. Recognized lines on a scan can be replaced with an estimated Helvetica font. Scan editing can change pixels around a selected line.
- Fill ordinary text fields, checkboxes, and single-choice dropdowns. Add text and ink to any PDF page and export those changes.
- DOCX page display includes layout, images, tables, and styles through docx-preview. Edit paragraph text while retaining the Word XML parts and distributing changes across existing runs.
- Legacy DOC files open in a text view. Edited legacy documents save as DOCX.
- Save copies on Windows through a native save dialog and on Android through the system document picker.
- The Windows application automatically recovers its last document session from its user-data directory.

## Current limits

This build handles one shared document at a time, with an upload limit of 40 MB. Android requires the Windows host to remain running. Pairing uses an address and code over local HTTP. Phone camera QR pairing and independent Android offline editing remain future work.

Word editing currently changes paragraph text. Advanced Word formatting, tracked changes, and fully faithful rendering of every Office feature need further implementation. PDF editing is limited to horizontal text. Unavailable characters, text with a rotated baseline, encrypted documents, complex PDF form types, and some unusual font encodings need further handling. OCR recognition and scan font estimation require visual review.

PDF annotation undo removes the latest added text or ink mark from the displayed page. It does not undo an original-text replacement. Session recovery retains the latest edited document, and Save copy creates a separate document file.

The APK has been compiled, signed and structurally verified. Browser tests cover desktop and a mobile viewport. Physical Android installation, handwriting latency, native file-picking and saving, and real phone-to-PC networking require device validation.

## Development

Use Node.js 24 or later. Run npm ci, then npm start. Run npm test for the focused document, OCR, synchronization, and recovery checks.

Run npm run build:windows to package the Windows application. The optional ELLESON_ELECTRON_ZIP_DIR environment variable selects an existing Electron ZIP directory.

The Android build script accepts Jdk, BuildTools, AndroidJar and Output parameters. It uses Android build tools 35, platform 35, Java 17 and Python with Pillow for icon format conversion. The application targets Android 15 with a minimum of Android 8. Its package name is za.co.elleson.docs.

See NOTICE.md and LICENSE for dependency licenses and the logo generation prompt. The combined application uses the GNU Affero General Public License, version 3 or later, because it includes MuPDF.js.
