# Elleson Docs

The current source is **0.4.23**. Elleson Docs is a Windows and Android document viewer and editor with standalone phone use and a shared workspace over local Wi-Fi. Connected devices share document edits, drawings, page position, scrolling and zoom. Other open tabs retain their own unsaved work. See [UPDATE-STATUS.md](UPDATE-STATUS.md) for release details and validation limits.

More includes Pages, Combine documents, Drawing tools, Recovery history and Phone companion. The scanner supports multiple photos, automatic page edges, perspective correction, thumbnails and page ordering. Open pictures as working PDFs and choose Save as PDF to export them. Pages can reorder, rotate, duplicate and remove PDF pages together while retaining app-added editable ink. Drawing tools select several drawings, change their colour, move, resize, duplicate or delete them, and add shapes to Word and PDF. Recovery history previews checkpoints before restoring them. Word files in Combine documents require the Windows renderer; merged form entries become printed content in the new PDF.

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

Use **More → Live collaboration** on Windows to create one-use invite links for the active PDF or DOCX. Collaborators open the link in a browser on the same trusted LAN and enter a display name. They can work at their own page and see participant presence and authored edits. Separate form fields and non-overlapping Word changes can be edited in parallel. Overlapping edits prompt for a choice. The host can remove people or end sharing. Whole-document undo and redo are available after sharing ends. Invites expire after ten minutes and guest sessions expire after 24 hours. The LAN connection uses HTTP.

For phone pairing, run Windows and connect both devices to the same trusted Wi-Fi. Select the PC in the Android app and approve the request on Windows. Enter the address from **Connect phone** when automatic discovery is unavailable. The phone is remembered for up to 30 days unless disconnected. Windows tries to keep the same local port across restarts. If that port is occupied, it uses another port and shows the new address.

On a paired phone, use **Phone companion** to scan and append pages to the active PC PDF, insert a camera photo after a selected Word paragraph, or place a handwritten signature in the shared document.

On Android, Open documents on phone works independently. Open with and Share accept PDF, DOCX and supported pictures from other applications. Continue on PC packages the current edited document and takes you to the connection screen. After connecting, it opens the edited file on the PC with the requested page and zoom. Continue on phone sends the paired document into the Android standalone workspace. Handoffs create a separate local copy; subsequent independent edits are not automatically merged into the old PC tab.

Connection status distinguishes connected, reconnecting and offline states and shows pending changes. Completed editing operations are retained in device storage during network loss and retried with the same operation ID. Conflicting PDF-field or Word-paragraph entries require an explicit keep-mine/use-latest choice. If an older operation cannot apply to a changed document, the app retains it until reviewed or explicitly discarded. A disconnected page must reconnect before it can reload network-served viewer assets.

## Files and saving

**Files** searches filenames, tags and text in the latest saved versions, including existing searchable PDF text and form answers. Use tag, file type and update-date filters. PDF results can jump to the matching page. Content indexing covers up to 200 pages per PDF.

Tabs retain independent edits and undo history while switching. The whole workspace recovers on restart. Up to 12 tabs are allowed, with additional memory limits. Closing an unsaved tab asks for confirmation. Save writes back to a tracked original file when access is available. Windows checks the original file's hash and asks before overwriting an external change, and writes through a temporary file. Android checks its tracked content URI and falls back to the system Save a copy picker when direct access is unavailable. Save a copy always creates a separate file. Ctrl+S invokes Save; Ctrl+Shift+S invokes Save a copy.

Files provides recent documents, pins, saved versions, deletion and version comparison. Comparison highlights differing text lines, form answers and page counts, with a 200-page text-extraction limit. It does not detect every visual-only change. Storage & backup reports saved-library usage, controls retention between 1 and 100 versions per document (default 20), and exports a ZIP of standard document files and an index. Recovery history provides PDF and DOCX previews, manual checkpoints, automatic checkpoints every minute for changed documents in the primary editor, and a checkpoint of current work before restoring an older version. The latest version is protected from individual deletion; the whole library document can be removed. Exported originals are kept. Retention changes delete older saved snapshots, so export a backup first when needed.

The library keeps a recovery index. Damaged indexes and missing files produce recovery guidance. PC session Undo holds up to 50 changes within an estimated 100 MB history budget and resets on restart. Android retains up to 30 changes in its local session. Saved-version limits do not include live tab histories. Clearing Android app data removes the app's local workspace and library; export important files separately.

## Scanning and interface

**More → PDF form tools** reviews required fields, jumps to missing answers, previews profile autofill, and creates or edits PDF fields. **Suggest fields from this page** uses existing text or local OCR to suggest positions from recognized labels and blanks. Review suggestions before applying them. Date fields use `YYYY-MM-DD` in Elleson Docs. Move and resize is available for fields with one widget.

**More → Privacy Inspector / Compress PDF** checks selected categories, saves a separate clean copy, and rechecks the result. It can also look for a specific redacted phrase in extractable page text. Review visible text and image pixels separately. PDF optimization retains the page objects and can optionally resize supported large JPEGs. Rewriting a PDF can invalidate certificate signatures.

The Word ribbon offers paragraph styles, heading navigation, linked contents lists, hyperlinks, footnotes, page setup for the selected section, and merging adjacent cells in the same table row.

Scan document captures up to 30 photos into one PDF. Each page has separate corner coordinates, perspective correction, straightening, and document/receipt/photo processing. Page-edge detection estimates corners from the largest connected paper region and must be checked on low-contrast or cluttered images. Document and receipt modes reduce uneven background brightness. OCR runs locally in English, French and Spanish using bundled language data.

Tool groups provide View, Edit, Fill & Sign, Pages and Scan controls. All tools remains available. On a phone, tools sit at the bottom; More contains additional save, handoff, history and print actions. PDF rendering cancels stale page requests during rapid navigation. Long-PDF and image-heavy-Word fixtures measure open and navigation times on the test PC.

## Limits and validation

Files must be smaller than 40 MB. Pairing uses local HTTP and is intended for a trusted local network. Protected/encrypted PDFs, unusual font encodings, complex form types and every Office structure are not fully supported. Scanned text uses estimated fonts. Reflow currently supports horizontal digital text with a consistent font; scanned and rotated text are edited line by line. DOCX rendering uses docx-preview and is not a complete Microsoft Word layout engine. Merged/irregular tables require a dedicated editor. Word image resizing targets the first image in the selected paragraph. Header/footer changes affect default section parts; complex first/even-page layouts need review. Page numbers are Word fields and depend on the receiving Word renderer's field calculation. Bookmarks and reusable signatures stay on their device.

Automated checks cover PDF fonts, paragraph reflow, image replacement, native annotations/replies, editable form combination, Word formatting and structure, saved versions, index recovery, independent tabs, queued edits, conflict choices, handoff packets and printed page counts. A browser harness serves only bundled Android assets for independent phone editing, multi-page scanning, perspective processing, OCR, export and recovery. Windows executable checks include original-file saving and external-change protection. Physical Android installation, native camera and saving, touch accuracy, real Wi-Fi interruptions and physical printers require hands-on device validation; browser checks do not establish those results.

## Install, development and license

Extract the complete Windows ZIP and run Elleson Docs.exe. Install.cmd adds shortcuts and Windows Open with registration. Install the APK on Android 8 or newer with a recent Android System WebView.

Use Node.js 24 or later. Run npm ci, npm run pretest, then npm start. npm test runs the test suite and generates browser bundles/Android assets first. Browser tests use Edge through Playwright. npm run build:windows packages Windows. scripts/build-android.ps1 accepts Jdk, BuildTools, AndroidJar and Output and requires Java 17, Android build tools/platform 35, Node dependencies and Python/Pillow. Android targets 15 and uses package za.co.elleson.docs.

See NOTICE.md and LICENSE for dependency licenses and the logo prompt. The combined application uses AGPL-3.0-or-later because it includes MuPDF.js. Keys, build outputs and dependencies are excluded from Git.
