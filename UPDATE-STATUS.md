# Elleson Docs 0.4.10

- Open PNG, JPEG, WebP, GIF and BMP from the standard file picker or the operating system. Pictures open as one-page working PDFs. File > Save as PDF writes a separate PDF and preserves the source picture.
- Windows uses the redesigned editor shell. Scroll with the mouse wheel and hold Ctrl to zoom around the cursor. Right-click a page, title, tab or saved file for document actions.
- Tap saved PDF or Word ink to edit it. An Android client can download signed updates from the PC over Wi-Fi.
- GIF import uses a single frame. The Android build still needs a physical-device check.

Verification: The full automated run passed 58 of 59 tests. The remaining Word selection test passed after waiting for the editor to finish rendering. Native Windows checks passed opening, editing, saving, reopening, external-change protection, mouse-wheel navigation and PNG-to-PDF export. Android 0.4.10 compiled and passed APK signature and alignment verification; physical-device behavior remains unverified.

## Elleson Docs 0.4.0

- Shared page-relative viewport: phone and PC follow scroll, page and zoom in both directions. Remote movement is suppressed from echoing back.
- Pinch navigation works in Word viewing/editing, PDF viewing/editing, continuous reading and the signature pad. Fixed zoom caps were removed. Rendering resolution remains bounded to protect canvas memory.
- Drawing settings expose pen colour and thickness for Word/PDF and signing, retain selections and share them with the connected view.
- Android document text scaling is fixed at 100 percent to preserve alignment with page-relative ink.
- Physical Android installation and network behavior remain to be checked on a device.

## Earlier build additions

- Word drawing previews stream to the other connected device before pen-up. Completed strokes automatically embed into the same shared DOCX, including strokes queued during an earlier upload. Save writes the external file.
- Two-finger zoom works over Word ink and the signature pad without leaving stray strokes. Signature Undo responds directly to touch taps. Ink uses smoothed paths, and new incoming writing briefly fades in without fading out existing content.
- Android permits the exact GitHub release API needed by the updater; network failures give a useful message. A published newer release is still required for update availability.
- Physical Android installation, discovery, camera and file-provider checks remain outstanding.

## Preview 3 additions

- Word pages preserve their natural dimensions and scale to the viewport, with fit-width and zoom controls. Document paragraph styling is isolated from generic app paragraph spacing.
- Word opens in editing mode. Selectable PDF text opens its editing control directly; form fields stay interactive.
- Edit > Draw / sign records touch strokes over Word pages. Save drawing embeds transparent PNG ink as an anchored drawing inside the DOCX. Draft strokes are retained on the device before upload. Save writes the external file.
- Same-Wi-Fi clients connect using the local connection route without codes or approval. Android selects the first discovered PC and remembers its address. The previous pairing routes remain for compatibility.
- More > Check for updates checks published GitHub releases. Android verifies the checksum, package identity, newer version and signing certificate before opening Android installation. Windows downloads and verifies an update ZIP for extraction; it does not silently replace running program files.
- Physical Android discovery, file-provider saving, update installation and camera behavior remain unverified.

### Earlier preview 2 notes

The app-wide review findings have been addressed in source and packaged for Windows x64 and Android. This remains a preview; physical Android camera, file-provider saving, Wi-Fi interruption, and printer behavior still require device checks.

- Input drafts are stored locally before the typing debounce, overlaid while offline, and reconciled after reload. Completed host edits are checkpointed before acknowledgement. File replacements flush a temporary file before publishing it. Save still explicitly writes the original file; recovery storage protects work between saves.
- Stale Word paragraph edits are rejected after structural changes, retained locally, and offered for manual placement. Paragraph splits move objects instead of duplicating them; unsupported tracked-change/field/content-control splits are rejected before changing the document.
- Word selection formatting follows the active paragraph and selection. Paragraph alignment/list/spacing applies when words are selected. Paragraph ownership excludes nested textboxes consistently on Windows and standalone Android.
- PDF radio buttons and choice lists, including multiple selections, are editable and exported with their values. Continuous reading retries after a temporary failure.
- Captured scans survive failed creation and reload. Resume captured scan reopens the retained draft; successful creation or explicit Cancel clears it.
- Android retains original and pending private recovery copies before writing an external file. Native file-provider and sudden power-loss behavior still need physical-device validation.
- Built Windows Word-to-PDF conversion produced a readable PDF with a table; its rendered page was visually inspected. This is not a guarantee of arbitrary Microsoft Word layout fidelity.

The dated notes below describe the earlier preview checkpoint. The final test evidence and current limitations are supplied with the fixed build.

---

## Earlier update - 13 November 2026

This is an in-progress update, not a claim that every requested improvement is complete.

## Implemented in source

- New Word or PDF documents, with optional starting text.
- PC Save As, Rename without replacing an existing destination, and native converter Save As with output-folder reveal. Android document-name changes explicitly require Save As to create a renamed external file.
- Share As opens the converter with the current edited document. Android converter outputs use the native sharing chooser. Windows falls back to saving and revealing the output.
- Converter: up to 20 input files/100 MB, ordering, PDF combination, image/text/DOCX-to-PDF, image/text/PDF-to-DOCX, text extraction, selected PDF pages, PDF pages to PNG/JPG, image-based PDF compression, OCR review, progress/cancellation, per-result saving and ZIP output with duplicate-name handling.
- A4/Letter/custom pages, margins, landscape, image fit/fill, JPEG quality and render resolution. Page settings apply to newly constructed pages, not copied PDF pages.
- Seven scanner presets plus the previous document cleanup mode, brightness/contrast/sharpness/whitening, processed preview, reset and apply-filter-to-all.
- Drawing Done button waits for pending operations; two-finger navigation cancels incomplete strokes and suppresses residual finger input until released.
- Continuous reading view of exported PDF pages, lazy nearby rendering, fit-width and zoom controls, local reading position, and return to editing. This is a snapshot: exit and reopen reading to see subsequent edits from another device.
- Desktop/phone shell spacing, compact mobile More menu, home actions, document tabs and bottom tool groups.
- Thumbnail-based page reordering alongside existing rotate/delete/extract/combine.
- AES-256 password-protected PDF copy, confirmation and validation; password is never stored in document metadata or URLs.
- Android LAN PC discovery via UDP 16944, remembered address startup, PC-approved first pairing without typing a code. Manual code/address fallback remains. Discovery depends on LAN/firewall configuration.

## Still open

- Physical Android installation, camera/provider behavior, real multi-touch, Wi-Fi discovery/interruption and native sharing. User has now asked to use wireless debugging; pairing details are pending.
- Full Microsoft Word-style ribbon and richer home/recent-file previews; current shell is an incremental redesign.
- Precise-layout Word-to-PDF/PDF-to-Word, legacy DOC conversion inside converter, RTF/HTML/Markdown formatting, TIFF/HEIC import, extracting embedded images, and searchable-PDF OCR layers. The UI exposes the supported subset rather than claiming all formats.
- Image compression rasterizes pages; interactive fields, searchable text and links become fixed pixels. The output can be larger, and the UI reports actual size before saving.
- Word/PDF text conversion does not preserve arbitrary layouts, images or tables. Unicode PDF generation needs embedded fonts and currently rejects unsupported text with guidance to export Word/text instead.
- Dragging scan crop corners, scan quality warnings, retake/scan ordering, full theme/focus controls, expanded search snippets and field navigation.
- Continuous reading should eventually support live updates, selectable text and gestures directly, rather than a read-only exported snapshot.
- Opening password-protected copies in Elleson Docs itself needs a password-opening workflow; compatible external PDF viewers can open them now.

## Checks so far

- Baseline 22 tests passed after initial integration.
- Added conversion/filter/encryption checks, PC-approval authentication check and browser checks for creation/rename/conversion/continuous reading/drawing Done and two-finger navigation.
- Android Java compile passed. Physical-device checks have not been performed.
- Latest full suite: 28 tests passed, 0 failed. Files navigation was updated for the new More menu.
- The packaged Windows executable passed launch, open/edit, native Save a Copy, reopen, original-file Save, and cancellation when another application changed the file.
- Android preview 0.4.0-preview.1 built with versionCode 4; APK v2/v3 signatures and package metadata verified. Device installation remains pending wireless pairing.
