# Elleson Docs

Elleson Docs 0.2.0 is a Windows and Android document viewer and editor. Android can open PDF and DOCX files independently, or connect to Windows for live two-way editing over local Wi-Fi. In a paired session, either device can open and save the shared document. Each device controls its own page and zoom.

## Included features

- PDF pages, selectable text, search, thumbnails, zoom, device bookmarks and embedded document outline navigation.
- Existing PDF text editing with original font, size, color and baseline, including rotated text. Preview replacements or explicitly choose a fallback font.
- Ordinary PDF text fields, checkboxes and single-choice dropdowns. Add text, handwriting, colored ink and highlights.
- A larger signature pad, reusable device signatures and three placement sizes. Erase marks or complete signatures. Undo and redo document changes.
- Camera/photo-to-PDF conversion with manual straightening. Local English, French and Spanish OCR, with bundled language data on both platforms.
- Rotate, delete, reorder and extract PDF pages. Combine documents as fixed pages, preserving visible answers and annotations.
- DOCX paragraph editing with existing text-run formatting retained. Paragraph fonts, sizes, bold, italic, alignment and lists. Insert tables and PNG/JPEG images.
- Windows legacy DOC text viewing and editing, with edited exports converted to DOCX.
- Recent documents, pinning, document tabs, saved versions and session recovery.
- Save-state indicators, confirmations before replacing unsaved work, ordinary and fixed PDF exports, and a print workflow.

## Use

Extract the complete Windows ZIP and run Elleson Docs.exe. Install.cmd adds desktop and Start menu shortcuts and registers supported types in Windows Open with. It does not change default applications automatically.

Install the APK on Android 8 or newer. Choose Open documents on phone for independent use. Android Open with and Share accept PDF and DOCX files from other apps. For live editing, keep Windows running, put both devices on the same Wi-Fi, choose Connect phone on Windows, then enter the displayed address and temporary pairing code in Android. Local phone documents and the PC session are separate. To bring an independently edited phone document into a PC session, save it on the phone, connect, and open that saved copy from the phone.

Files contains recent documents, pins and saved versions. Desktop tabs and the phone document selector reopen saved files. Switching away from unsaved work asks for confirmation. Save copy writes a separate file. A saved version is a document snapshot, while Undo and Redo operate on editing history.

## Scope and limits

Files must be smaller than 40 MB. One document is shared live at a time. Tabs reopen saved versions rather than keeping multiple simultaneous editing sessions. Pairing uses a temporary code over local HTTP, intended for a trusted local network.

Standalone Android supports PDF and DOCX and requires a recent Android System WebView. Legacy DOC requires the Windows host. Connecting does not automatically merge the standalone phone document with the PC document.

The original PDF font must contain replacement glyphs, and text must fit the available line width. Some unusual font encodings, protected/encrypted PDFs and complex form types remain unsupported. Scans use estimated fonts after OCR and require visual checking. Combining PDFs creates fixed content, so combined form fields are no longer interactive.

Word rendering uses docx-preview and is not a complete Microsoft Word layout engine. Advanced Office structures, tracked changes and every complex layout are not fully supported. Formatting applies to the selected paragraph. Images retain aspect ratio, but interactive image resizing and advanced table editing are not included. Moving or resizing an inserted signature requires erasing and placing it again. Bookmarks and reusable signatures are stored per device and are not embedded in exported documents.

PC Undo holds up to 50 changes within a 100 MB memory budget and resets on switching documents or restarting. Android retains up to 30 changes in its local session. Saved versions consume local storage independently. Clearing Android app data removes its local documents and versions. Export important files to system storage separately.

## Verification

Automated checks cover original and rotated PDF text, OCR, form-preserving page operations, fixed exports, revision-aware save state, saved versions, pins, recovery, Word formatting/tables/images, and live two-way PDF and Word changes. A browser harness serves only bundled Android assets to check independent editing, exports and recovery without a PC backend. The Windows executable is checked through actual launch, editing, native saving and reopening.

The APK build verifies compilation, signature, alignment and metadata. Physical Android installation, camera behavior, native saving, touch latency, network interruptions and real printers still require hands-on validation. Browser viewport checks do not establish physical-device behavior.

## Development and license

Use Node.js 24 or later. Run npm ci, npm run pretest, then npm start. Run npm test for automated checks. The pretest step generates browser bundles and Android assets. Browser tests use Edge through Playwright.

Run npm run build:windows to package Windows. ELLESON_ELECTRON_ZIP_DIR optionally selects an existing Electron ZIP directory. scripts/build-android.ps1 takes Jdk, BuildTools, AndroidJar and Output. It requires Java 17, Android build tools/platform 35, Node dependencies and Python with Pillow. Android targets version 15, requires version 8 or later and uses package za.co.elleson.docs.

See NOTICE.md and LICENSE for dependency licenses and the logo prompt. The combined application uses AGPL-3.0-or-later because it includes MuPDF.js. Signing keys, build outputs and dependencies are excluded from Git.
