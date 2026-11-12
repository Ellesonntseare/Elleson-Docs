# Elleson Docs

Elleson Docs 0.3.0 is a Windows and Android document viewer and editor. It supports independent phone use and live two-way editing over local Wi-Fi. Each device keeps its own page and zoom. The current shared tab is visible on both devices, while other tabs retain their own unsaved work.

## Documents and editing

- PDF viewing, selectable text, search, thumbnails, zoom, device bookmarks and embedded outlines.
- Original-font PDF text replacement, rotated text, fallback fonts and previews. Paragraph reflow supports horizontal digital text with consistent fonts, an explicit text-run count, text-area dimensions, alignment and spacing. Overlapping text areas and missing glyphs are rejected.
- PDF text fields, checkboxes and single-choice dropdowns; added text, handwriting and highlights.
- Select added content to drag, resize, rotate, duplicate, edit or delete it. Multistroke signatures transform and erase as a group. A larger signature pad and reusable device signatures are included.
- Insert or replace PDF images. Replacement removes image pixels in the selected image rectangle and preserves text in that region; overlapping images and complex compositions should be reviewed visually.
- Native PDF sticky notes, underlines, strikeouts, highlights and comment replies. These remain editable PDF annotations in ordinary exports.
- Rotate, delete, reorder and extract pages. Choose fixed combination or preserve supported editable form fields. Imported field names receive a unique prefix.
- DOCX paragraph and selected-word formatting, fonts, size, bold, italic, alignment and lists. Enter splits an editable paragraph. Insert paragraphs, page breaks, tables and images. Add/delete rows and columns in regular tables, resize a paragraph's image, and set default headers, footers and page-number fields.
- Windows opens legacy DOC as text and converts edited output to DOCX. Standalone Android supports PDF and DOCX.

## Phone and PC

For live editing, run Windows and put both devices on the same trusted Wi-Fi. Choose Connect phone on Windows, enter its address in Android, and pair using the temporary code. The phone is remembered for up to 30 days unless disconnected. Windows tries to keep the same local port across restarts. If that port is occupied, it uses another port and shows the new address.

On Android, Open documents on phone works independently. Open with and Share accept PDF and DOCX from other applications. Continue on PC packages the current edited document and takes you to the connection screen. After connecting, it opens the edited file on the PC with the requested page and zoom. Continue on phone sends the paired document into the Android standalone workspace. Handoffs create a separate local copy; subsequent independent edits are not automatically merged into the old PC tab.

Connection status distinguishes connected, reconnecting and offline states and shows pending changes. Completed editing operations are retained in device storage during network loss and retried with the same operation ID. Conflicting PDF-field or Word-paragraph entries require an explicit keep-mine/use-latest choice. If an older operation cannot apply to a changed document, the app retains it until reviewed or explicitly discarded. A disconnected page must reconnect before it can reload network-served viewer assets.

## Files and saving

Tabs retain independent edits and undo history while switching. The whole workspace recovers on restart. Up to 12 tabs are allowed, with additional memory limits. Closing an unsaved tab asks for confirmation. Save writes back to a tracked original file when access is available. Windows checks the original file's hash and asks before overwriting an external change, and writes through a temporary file. Android checks its tracked content URI and falls back to the system Save a copy picker when direct access is unavailable. Save a copy always creates a separate file. Ctrl+S invokes Save; Ctrl+Shift+S invokes Save a copy.

Files provides recent documents, pins, saved versions, deletion and version comparison. Comparison highlights differing text lines, form answers and page counts, with a 200-page text-extraction limit. It does not detect every visual-only change. Storage & backup reports saved-library usage, controls retention between 1 and 100 versions per document (default 20), and exports a ZIP of standard document files and an index. The latest version is protected from individual deletion; the whole library document can be removed. Exported originals are kept. Retention changes delete older saved snapshots, so export a backup first when needed.

The library keeps a recovery index. Damaged indexes and missing files produce recovery guidance. PC session Undo holds up to 50 changes within an estimated 100 MB history budget and resets on restart. Android retains up to 30 changes in its local session. Saved-version limits do not include live tab histories. Clearing Android app data removes the app's local workspace and library; export important files separately.

## Scanning and interface

Scan document captures up to 30 photos into one PDF. Each page has separate corner coordinates, perspective correction, straightening, and document/receipt/photo processing. Page-edge detection estimates corners from bright paper regions and must be checked on low-contrast or cluttered images. Document and receipt modes reduce uneven background brightness. OCR runs locally in English, French and Spanish using bundled language data.

Tool groups provide View, Edit, Fill & Sign, Pages and Scan controls. All tools remains available. On a phone, tools sit at the bottom; More contains additional save, handoff, history and print actions. PDF rendering cancels stale page requests during rapid navigation. Long-PDF and image-heavy-Word fixtures measure open and navigation times on the test PC.

## Limits and validation

Files must be smaller than 40 MB. Pairing uses local HTTP and is intended for a trusted local network. Protected/encrypted PDFs, unusual font encodings, complex form types and every Office structure are not fully supported. Scanned text uses estimated fonts. Reflow currently supports horizontal digital text with a consistent font; scanned and rotated text are edited line by line. DOCX rendering uses docx-preview and is not a complete Microsoft Word layout engine. Merged/irregular tables require a dedicated editor. Word image resizing targets the first image in the selected paragraph. Header/footer changes affect default section parts; complex first/even-page layouts need review. Page numbers are Word fields and depend on the receiving Word renderer's field calculation. Bookmarks and reusable signatures stay on their device.

Automated checks cover PDF fonts, paragraph reflow, image replacement, native annotations/replies, editable form combination, Word formatting and structure, saved versions, index recovery, independent tabs, queued edits, conflict choices, handoff packets and printed page counts. A browser harness serves only bundled Android assets for independent phone editing, multi-page scanning, perspective processing, OCR, export and recovery. Windows executable checks include original-file saving and external-change protection. Physical Android installation, native camera and saving, touch accuracy, real Wi-Fi interruptions and physical printers require hands-on device validation; browser checks do not establish those results.

## Install, development and license

Extract the complete Windows ZIP and run Elleson Docs.exe. Install.cmd adds shortcuts and Windows Open with registration. Install the APK on Android 8 or newer with a recent Android System WebView.

Use Node.js 24 or later. Run npm ci, npm run pretest, then npm start. npm test runs the test suite and generates browser bundles/Android assets first. Browser tests use Edge through Playwright. npm run build:windows packages Windows. scripts/build-android.ps1 accepts Jdk, BuildTools, AndroidJar and Output and requires Java 17, Android build tools/platform 35, Node dependencies and Python/Pillow. Android targets 15 and uses package za.co.elleson.docs.

See NOTICE.md and LICENSE for dependency licenses and the logo prompt. The combined application uses AGPL-3.0-or-later because it includes MuPDF.js. Keys, build outputs and dependencies are excluded from Git.
