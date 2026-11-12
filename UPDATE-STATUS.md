# Elleson Docs update — 13 November 2026

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
